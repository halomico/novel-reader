import type { QueryResultRow } from "pg";
import { MAX_GLOBAL_SEARCH_RESULTS } from "@/core/config/site-settings-schema";
import { postgresQueryTimeoutMs, withTransaction, type SqlExecutor, type SqlQuery } from "@/core/db/postgres";
import type { ParsedSearchQuery } from "@/lib/search-query";
import {
  findNormalizedChineseSearchRanges,
  normalizeChineseSearchForms,
  normalizeChineseSearchNeedles,
} from "./content-text";

/*
 * Full-text search over indexed content blocks, shaped by three facts measured with
 * pg_bigm on a 1 GB Chinese corpus:
 *
 * 1. A 2-character keyword is a single bigram, so the index answers it exactly and
 *    pg_bigm skips recheck. Longer keywords get a superset that must be verified
 *    against block text, and that verification is where the time goes.
 * 2. Results are listed newest first and capped, so most matches a query could find
 *    are never shown. Matching streams documents in that order through a cursor and
 *    stops at the cap: verification follows the cap, not the size of the library.
 * 3. A term with few candidate blocks is fastest driven from the index; a term found
 *    almost everywhere is fastest verified document by document, because nearly every
 *    document it meets matches at once. A capped count of each term's candidates picks
 *    the plan before any text is read.
 */

/** Exact candidates need no verification, so gathering them from the index stays
 *  cheaper than walking documents until they are this common. */
const EXACT_ANCHOR_BLOCKS = 400_000;
/** Candidates of longer keywords are verified one block each, so they anchor a search
 *  only while they are few. */
const VERIFY_ANCHOR_BLOCKS = 50_000;
/** When only long, dense keywords remain, gathering candidates still beats reading
 *  non-matching documents whole — up to this many blocks. */
const LAST_RESORT_ANCHOR_BLOCKS = 400_000;
const STREAM_FETCH_ROWS = 256;

/** Deployment-tunable budget, so a large library can be given more time without a code
 *  change. Values outside the bounds, and unset ones, use the default. */
function budgetMs(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}

/** Matching stops here and returns what it has, in order, with a cursor to continue from,
 *  so a pathological query degrades to a partial list instead of failing. A search holds
 *  a pooled connection for this long, so raising it far also wants a lower
 *  `frontendSearchConcurrencyLimit`, or other pages queue behind searches. */
const MATCH_BUDGET_MS = budgetMs("SEARCH_MATCH_BUDGET_MS", 5_000, 500, 30_000);
/** The part of the match budget planning may use; a probe still running then is
 *  counting a term dense enough that walking documents lists results faster. */
const PROBE_BUDGET_MS = budgetMs("SEARCH_PLAN_BUDGET_MS", 1_200, 100, 10_000);
/** Resolving the listed documents to snippets. Spent on one page of results, never on
 *  the size of the library. */
const PAGE_BUDGET_MS = budgetMs("SEARCH_SNIPPET_BUDGET_MS", 3_000, 500, 15_000);
/** One document's share when a whole page of snippets timed out and each is retried. */
const PER_DOCUMENT_PAGE_MS = 500;
const PROBE_SAVEPOINT = "content_search_probe";
const PAGE_SAVEPOINT = "content_search_page";
const MIN_STATEMENT_TIMEOUT_MS = 100;
/** Left for the round trip, so the server cancels a statement before node-postgres
 *  abandons it on its own timer, which would fail the search instead of trimming it. */
const STATEMENT_TIMEOUT_MARGIN_MS = 500;
const SEARCH_WORK_MEM = "32MB";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const RESULT_CACHE_TTL_MS = 60_000;
const RESULT_CACHE_ENTRIES = 256;
const STREAM_CURSOR = "content_search_stream";
const CONTENT_SEARCH_SNIPPET_LENGTH = 280;
const CONTENT_SEARCH_SNIPPET_LEADING_CONTEXT = 24;

export type PostgresContentSearchCursor = {
  mtimeMs: string;
  documentId: string;
  /** Results listed before this cursor, so the cap holds across a cursor walk. */
  shown: number;
};

export type PostgresContentSearchOptions = {
  novelId?: number;
  sourceId?: number;
  sourceSlug?: string;
  excludedSourceSlugs?: readonly string[];
  includeTagSlugs?: readonly string[];
  excludeTagSlugs?: readonly string[];
  titleQuery?: ParsedSearchQuery;
  audience?: "public" | "member" | "admin";
  /** The most results a search lists, newest first. */
  maxResults: number;
  pageSize?: number;
  page?: number;
  /** Continues a partial list after its last shown result. */
  cursor?: PostgresContentSearchCursor;
};

export type PostgresContentSearchItem = {
  documentId: string;
  novelId: number;
  chapterId: number | null;
  novelTitle: string;
  chapterTitle: string | null;
  contentVersion: string;
  blockNo: number;
  charStart: number;
  snippet: string;
  highlightRanges: Array<{ start: number; end: number }>;
};

export type PostgresContentSearchPage = {
  items: PostgresContentSearchItem[];
  page: number;
  /** Results within the cap; null when matching stopped at its time budget. */
  totalItems: number | null;
  totalNovels: number | null;
  /** More documents match than the cap lists. */
  capped: boolean;
  /** Matching stopped at its time budget; continue with `nextCursor`. */
  partial: boolean;
  nextCursor: PostgresContentSearchCursor | null;
};

/** Matching holds one connection for its cursor, so it runs inside a transaction. */
export type ContentSearchTransaction = <T>(operation: (executor: SqlExecutor) => Promise<T>) => Promise<T>;

export const readOnlyContentSearchTransaction: ContentSearchTransaction = (operation) =>
  withTransaction(operation, { role: "web", readOnly: true });

export type ContentSearchTermForm = { text: string; bigrams: readonly string[] };

export type ContentSearchTerm = {
  /** exact: every form is one bigram, answered exactly by the index. verify: the index
   *  returns a superset that is checked against block text. unindexed: a single
   *  character has no bigram, so it is only ever checked against text. */
  kind: "exact" | "verify" | "unindexed";
  forms: readonly ContentSearchTermForm[];
  length: number;
};

export type ContentSearchPlan =
  | { kind: "walk" }
  | { kind: "anchored"; anchors: readonly number[] };

type Builder = { values: unknown[]; parameter(value: unknown): string };
type CountsRow = QueryResultRow & { counts: Array<number | null> };
type StreamRow = QueryResultRow & { document_id: string; novel_id: number; mtime_ms: string; matched: boolean };
type MatchedDocument = { documentId: string; novelId: number; mtimeMs: string };
type MatchList = { matches: MatchedDocument[]; capped: boolean; complete: boolean };
type CandidateBlock = { blockNo: number; charStart: number; originalText: string };
type PageRow = QueryResultRow & {
  document_id: string;
  novel_id: number;
  chapter_id: number | null;
  novel_title: string;
  chapter_title: string | null;
  content_version: string;
  block_no: number;
  char_start: number;
  blocks: CandidateBlock[] | null;
};

function builder(): Builder {
  const values: unknown[] = [];
  return { values, parameter(value) { values.push(value); return `$${values.length}`; } };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

export async function planContentSearchTerms(query: ParsedSearchQuery): Promise<ContentSearchTerm[]> {
  if (query.mode !== "content") throw new Error("PostgreSQL content search requires a content query");
  if (query.syntax !== "simple-and") throw new Error("PostgreSQL content search only supports simple AND queries");
  if (!query.requiredTerms.length) throw new Error("PostgreSQL content search requires at least one term");
  const seen = new Set<string>();
  const terms: ContentSearchTerm[] = [];
  for (const required of query.requiredTerms) {
    const normalized = await normalizeChineseSearchForms(required.value, "content");
    const texts = [...new Set([normalized.original, normalized.hans].filter((text): text is string => Boolean(text)))];
    if (!texts.length) throw new Error("Content search term normalizes to an empty value");
    const key = [...texts].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const forms = texts.map((text) => {
      const characters = Array.from(text);
      const bigrams = [...new Set(characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`))];
      return { text, bigrams, length: characters.length };
    });
    const lengths = forms.map((form) => form.length);
    const kind = lengths.some((length) => length < 2) ? "unindexed" : lengths.every((length) => length === 2) ? "exact" : "verify";
    terms.push({ kind, forms: forms.map(({ text, bigrams }) => ({ text, bigrams })), length: Math.max(...lengths) });
  }
  // Longest first: the most selective term locates each result's snippet.
  return terms.sort((left, right) => right.length - left.length);
}

/** Index-served candidate test: every bigram of some form occurs in the block. */
function indexPredicate(sql: Builder, term: ContentSearchTerm, alias: string): string {
  return `(${term.forms.flatMap((form) => {
    const grams = form.bigrams.map((gram) => sql.parameter(escapeLike(gram)));
    const all = (column: string) => grams
      .map((gram) => `${alias}.${column} LIKE '%' || ${gram} || '%' ESCAPE E'\\\\'`)
      .join(" AND ");
    return [`(${all("search_text_original")})`, `(${alias}.search_text_hans IS NOT NULL AND ${all("search_text_hans")})`];
  }).join(" OR ")})`;
}

/** Exact containment. strpos cannot use the bigram index, which keeps per-document
 *  verification from being planned as a fresh index scan for every document. */
function matchPredicate(sql: Builder, term: ContentSearchTerm, alias: string): string {
  return `(${term.forms.flatMap((form) => {
    const text = sql.parameter(form.text);
    return [
      `strpos(${alias}.search_text_original, ${text}) > 0`,
      `(${alias}.search_text_hans IS NOT NULL AND strpos(${alias}.search_text_hans, ${text}) > 0)`,
    ];
  }).join(" OR ")})`;
}

async function indexedTitleTermSql(sql: Builder, value: string): Promise<string> {
  const forms = await normalizeChineseSearchForms(value, "title");
  const terms = [...new Set([forms.original, forms.hans].filter((term): term is string => Boolean(term)))];
  if (!terms.length) throw new Error("Title search term normalizes to an empty value");
  return `(${terms.map((term) => {
    const parameter = sql.parameter(escapeLike(term));
    return `(n.title_search_original LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'
      OR (n.title_search_hans IS NOT NULL AND n.title_search_hans LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'))`;
  }).join(" OR ")})`;
}

function normalizedSlug(value: string, field: string): string {
  const slug = value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (!slug || slug.length > 64 || /[\0\r\n]/u.test(slug)) throw new Error(`Invalid ${field}`);
  return slug;
}

function normalizedSlugs(values: readonly string[] | undefined, field: string): string[] {
  if (!values) return [];
  if (!Array.isArray(values) || values.length > 20) throw new Error(`Invalid ${field}`);
  return [...new Set(values.map((value) => normalizedSlug(value, field)))];
}

function positiveInt32(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new Error(`Invalid ${field}`);
  return value;
}

function normalizedMaxResults(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid content search result cap");
  return Math.min(value, MAX_GLOBAL_SEARCH_RESULTS);
}

function normalizedPageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid content search page size");
  return Math.min(value, MAX_PAGE_SIZE);
}

function normalizedPage(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error("Invalid content search page");
  return value;
}

function validateCursor(cursor: PostgresContentSearchCursor | undefined): void {
  if (!cursor) return;
  if (!/^(0|[1-9]\d{0,18})$/u.test(cursor.mtimeMs) || BigInt(cursor.mtimeMs) > 9_223_372_036_854_775_807n) {
    throw new Error("Invalid content search cursor timestamp");
  }
  if (!/^[1-9]\d*$/u.test(cursor.documentId) || BigInt(cursor.documentId) > 9_223_372_036_854_775_807n) {
    throw new Error("Invalid content search cursor document");
  }
  if (!Number.isSafeInteger(cursor.shown) || cursor.shown < 0 || cursor.shown > MAX_GLOBAL_SEARCH_RESULTS) {
    throw new Error("Invalid content search cursor position");
  }
}

async function scopeFilters(sql: Builder, options: PostgresContentSearchOptions): Promise<string[]> {
  const filters: string[] = [];
  if (options.sourceId !== undefined) {
    filters.push(`n.source_id = ${sql.parameter(positiveInt32(options.sourceId, "content search source"))}`);
  }
  if (options.novelId !== undefined) {
    filters.push(`n.id = ${sql.parameter(positiveInt32(options.novelId, "content search novel"))}`);
  }
  if (options.sourceSlug !== undefined) {
    const sourceSlug = normalizedSlug(options.sourceSlug, "content search source slug");
    if (sourceSlug !== "all") filters.push(`lower(s.slug) = ${sql.parameter(sourceSlug)}`);
  }
  const excludedSources = normalizedSlugs(options.excludedSourceSlugs, "excluded content search source");
  if (excludedSources.length) filters.push(`(s.id IS NULL OR lower(s.slug) <> ALL(${sql.parameter(excludedSources)}::text[]))`);
  if (options.titleQuery) {
    if (options.titleQuery.mode !== "title" || options.titleQuery.syntax !== "simple-and") {
      throw new Error("PostgreSQL content title filter only supports simple AND title queries");
    }
    for (const term of options.titleQuery.requiredTerms) filters.push(await indexedTitleTermSql(sql, term.value));
  }
  const audience = options.audience ?? "public";
  if (audience !== "public" && audience !== "member" && audience !== "admin") throw new Error("Invalid content search audience");
  const tagVisibility = audience === "admin"
    ? "TRUE"
    : audience === "member"
      ? "tag.visibility IN ('public', 'member')"
      : "tag.visibility = 'public'";
  for (const slug of normalizedSlugs(options.includeTagSlugs, "included content search tag")) {
    filters.push(`EXISTS (
      SELECT 1 FROM novel_tags tagged
      JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = n.id AND tag.slug = ${sql.parameter(slug)} AND ${tagVisibility}
    )`);
  }
  const excludedTags = normalizedSlugs(options.excludeTagSlugs, "excluded content search tag");
  if (excludedTags.length) {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM novel_tags tagged
      JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = n.id AND tag.slug = ANY(${sql.parameter(excludedTags)}::text[]) AND ${tagVisibility}
    )`);
  }
  return filters;
}

/** The candidate count below which a term is gathered from the index up front. */
export function contentSearchAnchorCap(term: ContentSearchTerm): number {
  return term.kind === "exact" ? EXACT_ANCHOR_BLOCKS : VERIFY_ANCHOR_BLOCKS;
}

/** Counts each indexed term's candidate blocks up to its cap, without reading block text. */
export function buildContentSearchProbeQuery(terms: readonly ContentSearchTerm[], caps: readonly number[]): SqlQuery {
  if (caps.length !== terms.length || caps.some((cap) => !Number.isSafeInteger(cap) || cap < 1)) {
    throw new Error("Invalid content search probe caps");
  }
  const sql = builder();
  const counts = terms.map((term, index) => term.kind === "unindexed"
    ? "NULL::integer"
    : `(SELECT count(*)::integer FROM (
        SELECT 1 FROM novel_content_blocks b WHERE ${indexPredicate(sql, term, "b")} LIMIT ${sql.parameter(caps[index])}
      ) candidates)`);
  return { text: `SELECT ARRAY[${counts.join(",\n      ")}]::integer[] AS counts`, values: sql.values };
}

/**
 * Picks the terms that anchor an index-driven plan: the one with the fewest candidates
 * leads, and others join it only while they are small enough that gathering them costs
 * less than checking those documents directly. Empty when no term is under its cap.
 */
export function selectContentSearchAnchors(
  terms: readonly ContentSearchTerm[],
  counts: readonly (number | null)[],
): number[] {
  const selective = terms
    .flatMap((term, index) => {
      const count = counts[index];
      return term.kind !== "unindexed" && count !== null && count !== undefined && count < contentSearchAnchorCap(term)
        ? [{ index, count }]
        : [];
    })
    .sort((left, right) => left.count - right.count);
  if (!selective.length) return [];
  return [
    selective[0].index,
    ...selective.slice(1).filter((entry) => entry.count < VERIFY_ANCHOR_BLOCKS).map((entry) => entry.index),
  ];
}

/**
 * Counts candidates inside the probe budget. A bitmap scan is built whole whatever its
 * LIMIT, so on a large library a very common term can take longer than the search is
 * allowed to; that is exactly the case a walk answers fastest. A timeout therefore
 * yields null instead of aborting the transaction and failing the search.
 */
async function probeCounts(
  tx: SqlExecutor,
  terms: readonly ContentSearchTerm[],
  caps: readonly number[],
  deadline: number,
): Promise<Array<number | null> | null> {
  const query = buildContentSearchProbeQuery(terms, caps);
  const counts = await attempt(tx, PROBE_SAVEPOINT, deadline - performance.now(),
    async () => (await tx.query<CountsRow>(query)).rows[0]?.counts);
  if (counts === null) return null;
  if (!Array.isArray(counts) || counts.length !== terms.length) throw new Error("Invalid PostgreSQL content search probe");
  return counts;
}

async function chooseContentSearchPlan(
  tx: SqlExecutor,
  terms: readonly ContentSearchTerm[],
  options: PostgresContentSearchOptions,
  deadline: number,
): Promise<ContentSearchPlan> {
  // One book has few documents: verifying them directly beats consulting the index.
  if (options.novelId !== undefined) return { kind: "walk" };
  // Planning may spend only part of the match budget, so a walk still has time to list.
  const probeDeadline = Math.min(deadline, performance.now() + PROBE_BUDGET_MS);
  const firstCounts = await probeCounts(tx, terms, terms.map(contentSearchAnchorCap), probeDeadline);
  if (!firstCounts) return { kind: "walk" };
  const anchors = selectContentSearchAnchors(terms, firstCounts);
  if (anchors.length) return { kind: "anchored", anchors };
  // An exact term this common matches nearly every document it meets, so walking them
  // newest first reaches the cap almost at once.
  if (terms.some((term) => term.kind === "exact")) return { kind: "walk" };
  // Only long, dense keywords remain. A walk would read every non-matching document
  // whole, so anchor on the least dense one while its candidates are cheap to gather.
  const verify = terms.flatMap((term, index) => term.kind === "verify" ? [index] : []);
  const counts = await probeCounts(tx, verify.map((index) => terms[index]), verify.map(() => LAST_RESORT_ANCHOR_BLOCKS), probeDeadline);
  if (!counts) return { kind: "walk" };
  let best = -1;
  counts.forEach((count, position) => {
    if (count === null || count >= LAST_RESORT_ANCHOR_BLOCKS) return;
    if (best < 0 || count < (counts[best] ?? Infinity)) best = position;
  });
  return best < 0 ? { kind: "walk" } : { kind: "anchored", anchors: [verify[best]] };
}

const ELIGIBLE_JOINS = `JOIN novels n ON n.id = d.novel_id
    LEFT JOIN novel_sources s ON s.id = n.source_id
    LEFT JOIN novel_chapters c ON c.novel_id = d.novel_id AND c.id = d.chapter_id
    JOIN novel_content_generations g ON g.document_id = d.id AND g.generation = d.active_generation AND g.state = 'published'`;

const ELIGIBLE_WHERE = `d.state = 'ready' AND d.active_generation > 0
      AND d.active_content_version = CASE WHEN d.chapter_id IS NULL THEN n.published_content_version ELSE c.published_content_version END`;

/**
 * Lists eligible documents newest first with a `matched` flag. The flag is only
 * computed as rows are fetched, so a cursor that stops at the cap never verifies the
 * rest. Anchored plans start from index candidates and check long keywords only on
 * the blocks that carry all their bigrams; everything else is checked by exact
 * containment within the document.
 */
export async function buildContentSearchStreamQuery(
  terms: readonly ContentSearchTerm[],
  plan: ContentSearchPlan,
  options: PostgresContentSearchOptions,
): Promise<SqlQuery> {
  validateCursor(options.cursor);
  const sql = builder();
  const anchors = plan.kind === "anchored" ? [...plan.anchors] : [];
  if (anchors.some((index) => !terms[index] || terms[index].kind === "unindexed")) throw new Error("Invalid content search anchor");
  const ctes = anchors.map((termIndex, position) => {
    const term = terms[termIndex];
    const blocks = term.kind === "verify" ? ", array_agg(b.block_no ORDER BY b.block_no) AS blocks" : "";
    return `anchor_${position} AS MATERIALIZED (
      SELECT b.document_id, b.generation${blocks}
      FROM novel_content_blocks b
      WHERE ${indexPredicate(sql, term, "b")}
      GROUP BY b.document_id, b.generation
    )`;
  });
  const checks = terms.flatMap((term, termIndex) => {
    const position = anchors.indexOf(termIndex);
    if (position >= 0 && term.kind === "exact") return [];
    if (position >= 0) {
      return [`EXISTS (
        SELECT 1 FROM unnest(a${position}.blocks) AS candidate(block_no)
        JOIN novel_content_blocks v ON v.document_id = d.id AND v.generation = d.active_generation AND v.block_no = candidate.block_no
        WHERE ${matchPredicate(sql, term, "v")}
      )`];
    }
    return [`EXISTS (
        SELECT 1 FROM novel_content_blocks v
        WHERE v.document_id = d.id AND v.generation = d.active_generation AND ${matchPredicate(sql, term, "v")}
      )`];
  });
  const scope = await scopeFilters(sql, options);
  const keyset = options.cursor
    ? `AND (n.mtime_ms, d.id) < (${sql.parameter(options.cursor.mtimeMs)}::bigint, ${sql.parameter(options.cursor.documentId)}::bigint)`
    : "";
  const from = anchors.length
    ? [
        "anchor_0 a0",
        ...anchors.slice(1).map((_, index) => `JOIN anchor_${index + 1} a${index + 1} ON a${index + 1}.document_id = a0.document_id AND a${index + 1}.generation = a0.generation`),
        "JOIN novel_documents d ON d.id = a0.document_id AND d.active_generation = a0.generation",
      ].join("\n    ")
    : "novel_documents d";
  return {
    text: `${ctes.length ? `WITH ${ctes.join(",\n    ")}\n    ` : ""}SELECT d.id::text AS document_id, d.novel_id, n.mtime_ms::text AS mtime_ms,
      ${checks.length ? checks.join("\n      AND ") : "TRUE"} AS matched
    FROM ${from}
    ${ELIGIBLE_JOINS}
    WHERE ${ELIGIBLE_WHERE}
      ${scope.length ? `AND ${scope.join("\n      AND ")}` : ""}
      ${keyset}
    ORDER BY n.mtime_ms DESC, d.id DESC`,
    values: sql.values,
  };
}

/** Resolves listed documents to titles, the first block containing the longest keyword
 *  and its neighbours for the snippet, in listed order. */
export function buildContentSearchPageQuery(terms: readonly ContentSearchTerm[], documentIds: readonly string[]): SqlQuery {
  if (!terms.length || terms[0].kind === "unindexed") throw new Error("Content search page needs an indexed keyword");
  if (documentIds.some((id) => !/^[1-9]\d*$/u.test(id))) throw new Error("Invalid content search page documents");
  const sql = builder();
  const ids = sql.parameter(documentIds);
  const hit = matchPredicate(sql, terms[0], "hit");
  return {
    text: `SELECT page.ordinality::integer AS ordinality, d.id::text AS document_id, d.novel_id, d.chapter_id,
      n.title AS novel_title,
      CASE WHEN d.chapter_id IS NULL THEN NULL ELSE coalesce(c.title_override, c.title) END AS chapter_title,
      d.active_content_version AS content_version, hit.block_no, hit.char_start,
      coalesce((SELECT jsonb_agg(jsonb_build_object('blockNo', source.block_no, 'charStart', source.char_start,
          'originalText', source.original_text) ORDER BY source.block_no)
        FROM novel_content_blocks source
        WHERE source.document_id = d.id AND source.generation = d.active_generation
          AND source.block_no BETWEEN greatest(hit.block_no - 1, 0) AND hit.block_no + 1), '[]'::jsonb) AS blocks
    FROM unnest(${ids}::bigint[]) WITH ORDINALITY AS page(document_id, ordinality)
    JOIN novel_documents d ON d.id = page.document_id AND d.state = 'ready' AND d.active_generation > 0
    JOIN novels n ON n.id = d.novel_id
    LEFT JOIN novel_chapters c ON c.novel_id = d.novel_id AND c.id = d.chapter_id
    JOIN LATERAL (
      SELECT hit.block_no, hit.char_start
      FROM novel_content_blocks hit
      WHERE hit.document_id = d.id AND hit.generation = d.active_generation AND ${hit}
      ORDER BY hit.block_no
      LIMIT 1
    ) hit ON true
    ORDER BY page.ordinality`,
    values: sql.values,
  };
}

/** No statement may outlive the driver's own timer: past it the query fails as a client
 *  error instead of a server cancellation the search can recover from. */
function statementCeilingMs(): number {
  return Math.max(MIN_STATEMENT_TIMEOUT_MS, postgresQueryTimeoutMs("web") - STATEMENT_TIMEOUT_MARGIN_MS);
}

async function setStatementTimeout(tx: SqlExecutor, milliseconds: number): Promise<void> {
  const bounded = Math.min(Math.max(MIN_STATEMENT_TIMEOUT_MS, Math.ceil(milliseconds)), statementCeilingMs());
  await tx.query({
    text: "SELECT set_config('statement_timeout', $1, true)",
    values: [`${bounded}ms`],
  });
}

function isStatementTimeout(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "57014";
}

/**
 * Runs statements inside a savepoint under their own timeout, and answers null when they
 * run out of time. A cancelled statement aborts its transaction, so without the savepoint
 * one slow step would take the whole search with it; with it, every caller can choose a
 * cheaper way to answer instead of failing.
 */
async function attempt<T>(
  tx: SqlExecutor,
  savepoint: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T | null> {
  if (timeoutMs <= 0) return null;
  await tx.query({ text: `SAVEPOINT ${savepoint}` });
  try {
    await setStatementTimeout(tx, timeoutMs);
    const value = await run();
    await tx.query({ text: `RELEASE SAVEPOINT ${savepoint}` });
    return value;
  } catch (error) {
    if (!isStatementTimeout(error)) throw error;
    await tx.query({ text: `ROLLBACK TO SAVEPOINT ${savepoint}` });
    return null;
  }
}

async function streamMatches(
  tx: SqlExecutor,
  stream: SqlQuery,
  need: number,
  deadline: number,
): Promise<{ matches: StreamRow[]; lastScanned: StreamRow | null; complete: boolean }> {
  const matches: StreamRow[] = [];
  // Where the walk reached, matched or not, so a budget that expires before the first
  // match still leaves somewhere to continue from instead of restarting at the newest.
  let lastScanned: StreamRow | null = null;
  await tx.query({ text: `SAVEPOINT ${STREAM_CURSOR}` });
  try {
    await setStatementTimeout(tx, deadline - performance.now());
    await tx.query({ text: `DECLARE ${STREAM_CURSOR} NO SCROLL CURSOR FOR ${stream.text}`, values: stream.values });
    let exhausted = false;
    while (matches.length < need) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await setStatementTimeout(tx, remaining);
      const batch = await tx.query<StreamRow>({ text: `FETCH ${STREAM_FETCH_ROWS} FROM ${STREAM_CURSOR}` });
      for (const row of batch.rows) {
        lastScanned = row;
        if (row.matched !== true) continue;
        matches.push(row);
        if (matches.length >= need) break;
      }
      if (batch.rows.length < STREAM_FETCH_ROWS) {
        exhausted = true;
        break;
      }
    }
    await tx.query({ text: `CLOSE ${STREAM_CURSOR}` });
    await tx.query({ text: `RELEASE SAVEPOINT ${STREAM_CURSOR}` });
    return { matches, lastScanned, complete: exhausted || matches.length >= need };
  } catch (error) {
    // The budget ran out inside a statement: keep the ordered prefix already fetched.
    if (!isStatementTimeout(error)) throw error;
    await tx.query({ text: `ROLLBACK TO SAVEPOINT ${STREAM_CURSOR}` });
    return { matches, lastScanned, complete: false };
  }
}

type CacheEntry = { expiresAt: number; list: MatchList };
const cacheHolder = globalThis as typeof globalThis & { novelReaderContentSearchResults?: Map<string, CacheEntry> };

/** Complete result lists are reused briefly, so paging through them costs one page
 *  lookup and every page sees the same list. Stale entries only drop documents that
 *  are no longer published, which the page lookup excludes anyway. */
function resultCache(): Map<string, CacheEntry> {
  cacheHolder.novelReaderContentSearchResults ||= new Map();
  return cacheHolder.novelReaderContentSearchResults;
}

function readCachedMatches(key: string): MatchList | null {
  const cache = resultCache();
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  if (entry.expiresAt <= Date.now()) return null;
  cache.set(key, entry);
  return entry.list;
}

function writeCachedMatches(key: string, list: MatchList): void {
  const cache = resultCache();
  cache.delete(key);
  cache.set(key, { expiresAt: Date.now() + RESULT_CACHE_TTL_MS, list });
  while (cache.size > RESULT_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
}

function cacheKey(terms: readonly ContentSearchTerm[], options: PostgresContentSearchOptions, maxResults: number): string {
  return JSON.stringify({
    terms: terms.map((term) => term.forms.map((form) => form.text).join("|")).sort(),
    novelId: options.novelId ?? null,
    sourceId: options.sourceId ?? null,
    sourceSlug: options.sourceSlug === undefined ? null : normalizedSlug(options.sourceSlug, "content search source slug"),
    excludedSources: normalizedSlugs(options.excludedSourceSlugs, "excluded content search source").sort(),
    includeTags: normalizedSlugs(options.includeTagSlugs, "included content search tag").sort(),
    excludeTags: normalizedSlugs(options.excludeTagSlugs, "excluded content search tag").sort(),
    title: options.titleQuery?.requiredTerms.map((term) => term.value) ?? [],
    audience: options.audience ?? "public",
    maxResults,
  });
}

async function snippet(
  row: PageRow,
  needles: readonly string[],
): Promise<{ text: string; charStart: number; highlightRanges: Array<{ start: number; end: number }> }> {
  const blocks = row.blocks || [];
  const text = blocks.map((block) => block.originalText).join("");
  const currentBlockIndex = blocks.findIndex((block) => block.blockNo === row.block_no);
  const currentBlockStart = currentBlockIndex > 0
    ? blocks.slice(0, currentBlockIndex).reduce((length, block) => length + block.originalText.length, 0)
    : 0;
  const currentBlockEnd = currentBlockStart + (blocks[currentBlockIndex]?.originalText.length || 0);
  const ranges = await findNormalizedChineseSearchRanges(text, needles);
  const match = ranges.find((range) => range.end > currentBlockStart && range.start < currentBlockEnd) || ranges[0];
  const matchStart = match?.start ?? 0;
  const start = Math.max(0, Math.min(matchStart - CONTENT_SEARCH_SNIPPET_LEADING_CONTEXT, text.length - CONTENT_SEARCH_SNIPPET_LENGTH));
  const end = Math.min(text.length, start + CONTENT_SEARCH_SNIPPET_LENGTH);
  const raw = text.slice(start, end);
  const leadingWhitespace = raw.length - raw.trimStart().length;
  const trailingWhitespace = raw.length - raw.trimEnd().length;
  const contentStart = start + leadingWhitespace;
  const contentEnd = Math.max(contentStart, end - trailingWhitespace);
  const prefix = contentStart > 0 ? "..." : "";
  const suffix = contentEnd < text.length ? "..." : "";
  const highlightRanges = ranges.flatMap((range) => {
    const clippedStart = Math.max(range.start, contentStart);
    const clippedEnd = Math.min(range.end, contentEnd);
    return clippedStart < clippedEnd
      ? [{ start: prefix.length + clippedStart - contentStart, end: prefix.length + clippedEnd - contentStart }]
      : [];
  });
  return {
    text: `${prefix}${text.slice(contentStart, contentEnd)}${suffix}`,
    charStart: (blocks[0]?.charStart ?? row.char_start) + matchStart,
    highlightRanges,
  };
}

/**
 * Reads the snippet rows for one page of listed documents. A single pathological document
 * must not cost the whole page, so a page statement that runs out of time is retried one
 * document at a time and lists those that answer. A match whose snippet never arrives is
 * left out of the page rather than failing a search that already found it.
 */
async function pageRows(
  tx: SqlExecutor,
  terms: readonly ContentSearchTerm[],
  documents: readonly MatchedDocument[],
): Promise<PageRow[]> {
  const deadline = performance.now() + PAGE_BUDGET_MS;
  const ids = documents.map((document) => document.documentId);
  const whole = await attempt(tx, PAGE_SAVEPOINT, deadline - performance.now(),
    async () => (await tx.query<PageRow>(buildContentSearchPageQuery(terms, ids))).rows);
  if (whole) return whole;
  const rows: PageRow[] = [];
  for (const id of ids) {
    const row = await attempt(tx, PAGE_SAVEPOINT, Math.min(deadline - performance.now(), PER_DOCUMENT_PAGE_MS),
      async () => (await tx.query<PageRow>(buildContentSearchPageQuery(terms, [id]))).rows[0]);
    if (row) rows.push(row);
  }
  return rows;
}

async function pageItems(
  tx: SqlExecutor,
  terms: readonly ContentSearchTerm[],
  documents: readonly MatchedDocument[],
  needles: readonly string[],
): Promise<PostgresContentSearchItem[]> {
  if (!documents.length) return [];
  const rows = await pageRows(tx, terms, documents);
  return Promise.all(rows.map(async (row) => {
    const excerpt = await snippet(row, needles);
    return {
      documentId: row.document_id,
      novelId: row.novel_id,
      chapterId: row.chapter_id,
      novelTitle: row.novel_title,
      chapterTitle: row.chapter_title,
      contentVersion: row.content_version,
      blockNo: row.block_no,
      charStart: excerpt.charStart,
      snippet: excerpt.text,
      highlightRanges: excerpt.highlightRanges,
    };
  }));
}

function matchedDocument(row: StreamRow): MatchedDocument {
  return { documentId: row.document_id, novelId: row.novel_id, mtimeMs: row.mtime_ms };
}

function cursorAfter(document: MatchedDocument | undefined, shown: number): PostgresContentSearchCursor | null {
  return document ? { mtimeMs: document.mtimeMs, documentId: document.documentId, shown } : null;
}

export async function searchPostgresContent(
  transaction: ContentSearchTransaction,
  query: ParsedSearchQuery,
  options: PostgresContentSearchOptions,
): Promise<PostgresContentSearchPage> {
  const maxResults = normalizedMaxResults(options.maxResults);
  const pageSize = normalizedPageSize(options.pageSize);
  const page = normalizedPage(options.page);
  validateCursor(options.cursor);
  if (options.cursor && page !== 1) throw new Error("Content search cursor and page cannot be combined");
  const terms = await planContentSearchTerms(query);
  // Validate filters before borrowing a connection.
  await scopeFilters(builder(), options);
  const needles = await normalizeChineseSearchNeedles(query.highlightTerms.map((term) => term.value));
  const key = options.cursor ? null : cacheKey(terms, options, maxResults);
  const cached = key ? readCachedMatches(key) : null;

  return transaction(async (tx) => {
    await tx.query({
      text: "SELECT set_config('jit', 'off', true), set_config('work_mem', $1, true)",
      values: [SEARCH_WORK_MEM],
    });

    if (options.cursor) {
      const shown = options.cursor.shown;
      const capacity = Math.min(pageSize, maxResults - shown);
      if (capacity <= 0) {
        return { items: [], page: Math.floor(shown / pageSize) + 1, totalItems: null, totalNovels: null, capped: false, partial: true, nextCursor: null };
      }
      const deadline = performance.now() + MATCH_BUDGET_MS;
      const plan = await chooseContentSearchPlan(tx, terms, options, deadline);
      const stream = await streamMatches(tx, await buildContentSearchStreamQuery(terms, plan, options), capacity + 1, deadline);
      const documents = stream.matches.slice(0, capacity).map(matchedDocument);
      const more = stream.matches.length > capacity || !stream.complete;
      const listed = shown + documents.length;
      // A stretch that matched nothing leaves no result to continue after, so the walk's
      // last scanned document carries the position instead: without it the next request
      // would restart at the newest document and never get past this stretch.
      const resume = documents.at(-1) ?? (stream.lastScanned ? matchedDocument(stream.lastScanned) : undefined);
      return {
        items: await pageItems(tx, terms, documents, needles),
        page: Math.floor(shown / pageSize) + 1,
        totalItems: null,
        totalNovels: null,
        capped: false,
        partial: true,
        nextCursor: more && listed < maxResults ? cursorAfter(resume, listed) : null,
      };
    }

    let list = cached;
    // Only a freshly streamed list can be partial, so this is set whenever it is needed.
    let scanned: MatchedDocument | undefined;
    if (!list) {
      const deadline = performance.now() + MATCH_BUDGET_MS;
      const plan = await chooseContentSearchPlan(tx, terms, options, deadline);
      const stream = await streamMatches(tx, await buildContentSearchStreamQuery(terms, plan, options), maxResults + 1, deadline);
      list = {
        matches: stream.matches.slice(0, maxResults).map(matchedDocument),
        capped: stream.matches.length > maxResults,
        complete: stream.complete,
      };
      scanned = stream.lastScanned ? matchedDocument(stream.lastScanned) : undefined;
      if (list.complete && key) writeCachedMatches(key, list);
    }
    const start = (page - 1) * pageSize;
    const documents = list.matches.slice(start, start + pageSize);
    const items = await pageItems(tx, terms, documents, needles);
    if (!list.complete) {
      // A page beyond the matches found so far lists none of them, so what has been shown
      // stops at the end of the list rather than at the requested offset.
      const listed = documents.length ? start + documents.length : Math.min(start, list.matches.length);
      const resume = documents.at(-1) ?? list.matches.at(-1) ?? scanned;
      return {
        items,
        page,
        totalItems: null,
        totalNovels: null,
        capped: false,
        partial: true,
        nextCursor: listed < maxResults ? cursorAfter(resume, listed) : null,
      };
    }
    return {
      items,
      page,
      totalItems: list.matches.length,
      totalNovels: new Set(list.matches.map((document) => document.novelId)).size,
      capped: list.capped,
      partial: false,
      nextCursor: null,
    };
  });
}
