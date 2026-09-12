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
 * Full-text search over indexed content blocks, shaped by how pg_bigm answers a Chinese
 * corpus:
 *
 * 1. A 2-character keyword is a single bigram, so the index answers it exactly. Longer
 *    keywords get a superset that must be verified against block text, and reading that
 *    text is where the time goes.
 * 2. Documents are listed by `novel_documents.id` descending — most recently indexed
 *    first — because that is the order both scan strategies below already produce.
 *    Nothing is ranked or sorted at query time: a sort has to verify every candidate
 *    document before it can emit its first row, which is the difference between
 *    answering one page and reading the whole library.
 * 3. Keywords are tested in WHERE under a LIMIT, so a search costs what the results it
 *    lists cost rather than what the corpus costs.
 *
 * Two strategies produce that same order, and one search may use both:
 *  - walk: read documents newest first and verify each one. Cost follows the number of
 *    results asked for, so a keyword found almost everywhere answers immediately.
 *  - anchored: gather the longest keyword's candidate blocks from the bigm index, then
 *    verify the other keywords on those documents only. Cost follows how rare that
 *    keyword is, so a keyword nothing else would find is located at once.
 *
 * Measuring which one to use up front costs as much as the anchored plan itself — a GIN
 * bitmap is built whole whatever LIMIT it is given — so the search does not measure. It
 * walks under a short trial budget, and if the walk is producing too slowly to finish in
 * the time left it anchors for the rest. Because both strategies list in the same order,
 * the anchored continuation resumes below the last id the walk listed: nothing is
 * repeated and nothing is skipped.
 */

const STREAM_FETCH_ROWS = 256;

/** Deployment-tunable budget, so a large library can be given more time without a code
 *  change. Values outside the bounds, and unset ones, use the default. */
function budgetMs(name: string, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}

/** Matching stops here and lists what it has, so a pathological query degrades to a
 *  shorter list instead of failing. A search holds a pooled connection for this long, so
 *  raising it far also wants a lower `frontendSearchConcurrencyLimit`, or other pages
 *  queue behind searches. */
const MATCH_BUDGET_MS = budgetMs("SEARCH_MATCH_BUDGET_MS", 3_000, 500, 30_000);
/** How long the walk runs before its rate is judged. Long enough to finish outright for a
 *  keyword that is everywhere, short enough to be worth little when it is not. */
const WALK_TRIAL_MS = budgetMs("SEARCH_WALK_TRIAL_MS", 400, 50, 5_000);
/** Resolving the listed documents to snippets. Spent on one page of results, never on the
 *  size of the library. */
const PAGE_BUDGET_MS = budgetMs("SEARCH_SNIPPET_BUDGET_MS", 3_000, 500, 15_000);
/** One document's share when a whole page of snippets timed out and each is retried. */
const PER_DOCUMENT_PAGE_MS = 500;
/** A finished list is reused across pages and repeat searches; a list cut short by the
 *  budget is reused only long enough to page through it consistently. */
const RESULT_CACHE_TTL_MS = budgetMs("SEARCH_RESULT_CACHE_MS", 300_000, 1_000, 3_600_000);
const PARTIAL_CACHE_TTL_MS = 60_000;
const RESULT_CACHE_ENTRIES = 256;
/** Sorting and hashing room for one search. Matching carries only document ids, so this
 *  bounds the anchor's candidate set rather than any text. */
const SEARCH_WORK_MEM = process.env.SEARCH_WORK_MEM?.trim() || "64MB";
const PAGE_SAVEPOINT = "content_search_page";
const STREAM_SAVEPOINT = "content_search_stream";
const STREAM_CURSOR = "content_search_cursor";
const MIN_STATEMENT_TIMEOUT_MS = 100;
/** Left for the round trip, so the server cancels a statement before node-postgres
 *  abandons it on its own timer, which would fail the search instead of trimming it. */
const STATEMENT_TIMEOUT_MARGIN_MS = 500;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CONTENT_SEARCH_SNIPPET_LENGTH = 280;
const CONTENT_SEARCH_SNIPPET_LEADING_CONTEXT = 24;

export type PostgresContentSearchOptions = {
  novelId?: number;
  sourceId?: number;
  sourceSlug?: string;
  excludedSourceSlugs?: readonly string[];
  includeTagSlugs?: readonly string[];
  excludeTagSlugs?: readonly string[];
  titleQuery?: ParsedSearchQuery;
  audience?: "public" | "member" | "admin";
  /** The most results a search lists. */
  maxResults: number;
  pageSize?: number;
  page?: number;
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
  /** Results listed; every one of them can be paged to. */
  totalItems: number;
  totalNovels: number;
  /** More documents match than the cap lists. */
  capped: boolean;
  /** Matching stopped at its time budget, so more matches exist than were listed. */
  partial: boolean;
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

export type ContentSearchPlan = { kind: "walk" } | { kind: "anchored" };

type Builder = { values: unknown[]; parameter(value: unknown): string };
type StreamRow = QueryResultRow & { document_id: string; novel_id: number };
type MatchedDocument = { documentId: string; novelId: number };
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
  // Longest first: the rarest keyword is the one worth anchoring on, and the same term
  // locates each result's snippet.
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

/** Only the longest keyword is ever anchored on, and only where the index can narrow
 *  anything: a single character has no bigram, and one book has too few documents for an
 *  index lookup to beat reading them. */
export function canAnchorContentSearch(
  terms: readonly ContentSearchTerm[],
  options: PostgresContentSearchOptions,
): boolean {
  return options.novelId === undefined && terms[0] !== undefined && terms[0].kind !== "unindexed";
}

/**
 * Everything a document must satisfy besides the keywords, written as correlated
 * subqueries rather than joins. A join can be reordered, and the moment PostgreSQL is
 * free to reorder it is also free to answer `ORDER BY d.id` with a sort on top — which
 * would have to verify every candidate in the library before emitting the first row. As
 * subqueries these are filters on one relation, so the only plan is to read documents in
 * id order and stop at the limit.
 */
function eligibilityFilters(scopeSql: string): string[] {
  return [
    "d.state = 'ready'",
    "d.active_generation > 0",
    `EXISTS (
        SELECT 1 FROM novels n
        LEFT JOIN novel_sources s ON s.id = n.source_id
        LEFT JOIN novel_chapters c ON c.novel_id = d.novel_id AND c.id = d.chapter_id
        WHERE n.id = d.novel_id
          AND d.active_content_version = CASE WHEN d.chapter_id IS NULL THEN n.published_content_version ELSE c.published_content_version END${scopeSql}
      )`,
    `EXISTS (
        SELECT 1 FROM novel_content_generations g
        WHERE g.document_id = d.id AND g.generation = d.active_generation AND g.state = 'published'
      )`,
  ];
}

/**
 * Lists matching documents by descending id, at most `limit` of them, resuming below
 * `afterDocumentId`. Keywords are tested in WHERE, so PostgreSQL stops reading as soon as
 * the limit is met. An anchored plan starts from the longest keyword's index candidates
 * and, when that keyword needs verifying, checks it only on the blocks carrying all its
 * bigrams; every other keyword is checked by exact containment within the document.
 */
export async function buildContentSearchStreamQuery(
  terms: readonly ContentSearchTerm[],
  plan: ContentSearchPlan,
  options: PostgresContentSearchOptions,
  limit: number,
  afterDocumentId?: string,
): Promise<SqlQuery> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Invalid content search limit");
  if (afterDocumentId !== undefined && !/^[1-9]\d{0,18}$/u.test(afterDocumentId)) {
    throw new Error("Invalid content search position");
  }
  const anchored = plan.kind === "anchored";
  if (anchored && !canAnchorContentSearch(terms, options)) throw new Error("Invalid content search anchor");
  const sql = builder();
  const anchorTerm = terms[0];
  // The position rides on whichever relation drives the scan, so it narrows the anchor's
  // candidate blocks rather than only filtering documents after the fact.
  const after = (alias: string) => afterDocumentId === undefined
    ? []
    : [`${alias} < ${sql.parameter(afterDocumentId)}::bigint`];
  const anchorCte = anchored
    ? `WITH anchor AS MATERIALIZED (
      SELECT b.document_id, b.generation${anchorTerm.kind === "verify" ? ", array_agg(b.block_no ORDER BY b.block_no) AS blocks" : ""}
      FROM novel_content_blocks b
      WHERE ${[indexPredicate(sql, anchorTerm, "b"), ...after("b.document_id")].join("\n        AND ")}
      GROUP BY b.document_id, b.generation
      ORDER BY b.document_id DESC
    )\n    `
    : "";
  const checks = terms.flatMap((term, index) => {
    if (anchored && index === 0) {
      if (term.kind === "exact") return [];
      return [`EXISTS (
        SELECT 1 FROM unnest(a.blocks) AS candidate(block_no)
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
  const scopeSql = scope.length ? `\n          AND ${scope.join("\n          AND ")}` : "";
  const documentFilters = [...eligibilityFilters(scopeSql), ...checks];
  // An anchored scan is driven by the ordered candidate list: LATERAL makes PostgreSQL
  // walk it one document at a time, so the limit stops the scan and the candidates' order
  // is the result order. A walk is driven by the document table's own key order.
  return {
    text: anchored
      ? `${anchorCte}SELECT a.document_id::text AS document_id, hit.novel_id
    FROM anchor a
    JOIN LATERAL (
      SELECT d.novel_id
      FROM novel_documents d
      WHERE d.id = a.document_id AND d.active_generation = a.generation
        AND ${documentFilters.join("\n        AND ")}
    ) hit ON true
    LIMIT ${sql.parameter(limit)}::integer`
      : `SELECT d.id::text AS document_id, d.novel_id
    FROM novel_documents d
    WHERE ${[...after("d.id"), ...documentFilters].join("\n      AND ")}
    ORDER BY d.id DESC
    LIMIT ${sql.parameter(limit)}::integer`,
    values: sql.values,
  };
}

/** Resolves listed documents to titles, the first block containing the longest keyword
 *  and its neighbours for the snippet, in listed order. */
export function buildContentSearchPageQuery(terms: readonly ContentSearchTerm[], documentIds: readonly string[]): SqlQuery {
  if (!terms.length) throw new Error("Content search page needs a keyword");
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

/**
 * Reads one scan's matches in batches, so a batch that runs out of time keeps every batch
 * before it. `complete` means the scan has nothing more to give: it either reached the
 * limit or ran off the end of its candidates.
 */
async function streamMatches(
  tx: SqlExecutor,
  stream: SqlQuery,
  need: number,
  deadline: number,
): Promise<{ matches: MatchedDocument[]; complete: boolean }> {
  const matches: MatchedDocument[] = [];
  if (deadline - performance.now() <= 0) return { matches, complete: false };
  await tx.query({ text: `SAVEPOINT ${STREAM_SAVEPOINT}` });
  try {
    await setStatementTimeout(tx, deadline - performance.now());
    await tx.query({ text: `DECLARE ${STREAM_CURSOR} NO SCROLL CURSOR FOR ${stream.text}`, values: stream.values });
    let exhausted = false;
    while (matches.length < need) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) break;
      await setStatementTimeout(tx, remaining);
      const size = Math.min(STREAM_FETCH_ROWS, need - matches.length);
      const batch = await tx.query<StreamRow>({ text: `FETCH ${size} FROM ${STREAM_CURSOR}` });
      for (const row of batch.rows) matches.push({ documentId: row.document_id, novelId: row.novel_id });
      if (batch.rows.length < size) {
        exhausted = true;
        break;
      }
    }
    await tx.query({ text: `CLOSE ${STREAM_CURSOR}` });
    await tx.query({ text: `RELEASE SAVEPOINT ${STREAM_SAVEPOINT}` });
    return { matches, complete: exhausted || matches.length >= need };
  } catch (error) {
    // The budget ran out inside a statement: keep the ordered prefix already fetched.
    // Rolling back discards the cursor too, so this scan is over either way.
    if (!isStatementTimeout(error)) throw error;
    await tx.query({ text: `ROLLBACK TO SAVEPOINT ${STREAM_SAVEPOINT}` });
    return { matches, complete: false };
  }
}

/**
 * Lists up to `need` matches within the budget. The walk goes first because it costs only
 * what it lists; if it is producing too slowly to finish in the time left, the rest is
 * anchored on the index instead. Both list by descending document id, so the second scan
 * resumes below the last id the first one listed.
 */
export async function collectContentSearchMatches(
  tx: SqlExecutor,
  terms: readonly ContentSearchTerm[],
  options: PostgresContentSearchOptions,
  need: number,
  deadline: number,
): Promise<{ matches: MatchedDocument[]; complete: boolean }> {
  const startedAt = performance.now();
  const walk = await streamMatches(
    tx,
    await buildContentSearchStreamQuery(terms, { kind: "walk" }, options, need),
    need,
    Math.min(deadline, startedAt + WALK_TRIAL_MS),
  );
  if (walk.complete) return walk;
  const elapsed = Math.max(1, performance.now() - startedAt);
  const remaining = deadline - performance.now();
  // What finishing the walk would cost at the rate it has managed so far. Nothing found
  // leaves no rate to project, so the index takes over.
  const projected = walk.matches.length
    ? (need - walk.matches.length) * elapsed / walk.matches.length
    : Number.POSITIVE_INFINITY;
  const plan: ContentSearchPlan = projected <= remaining || !canAnchorContentSearch(terms, options)
    ? { kind: "walk" }
    : { kind: "anchored" };
  const need2 = need - walk.matches.length;
  const rest = await streamMatches(
    tx,
    await buildContentSearchStreamQuery(terms, plan, options, need2, walk.matches.at(-1)?.documentId),
    need2,
    deadline,
  );
  return { matches: [...walk.matches, ...rest.matches], complete: rest.complete };
}

type CacheEntry = { expiresAt: number; list: MatchList };
const cacheHolder = globalThis as typeof globalThis & { novelReaderContentSearchResults?: Map<string, CacheEntry> };

/** Result lists are reused briefly, so paging through one costs a single page lookup and
 *  every page sees the same list. Stale entries only drop documents that are no longer
 *  published, which the page lookup excludes anyway. */
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
  cache.set(key, { expiresAt: Date.now() + (list.complete ? RESULT_CACHE_TTL_MS : PARTIAL_CACHE_TTL_MS), list });
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

export async function searchPostgresContent(
  transaction: ContentSearchTransaction,
  query: ParsedSearchQuery,
  options: PostgresContentSearchOptions,
): Promise<PostgresContentSearchPage> {
  const maxResults = normalizedMaxResults(options.maxResults);
  const pageSize = normalizedPageSize(options.pageSize);
  const page = normalizedPage(options.page);
  const terms = await planContentSearchTerms(query);
  // Validate filters before borrowing a connection.
  await scopeFilters(builder(), options);
  const needles = await normalizeChineseSearchNeedles(query.highlightTerms.map((term) => term.value));
  const key = cacheKey(terms, options, maxResults);
  const cached = readCachedMatches(key);

  return transaction(async (tx) => {
    await tx.query({
      text: "SELECT set_config('jit', 'off', true), set_config('work_mem', $1, true)",
      values: [SEARCH_WORK_MEM],
    });

    let list = cached;
    if (!list) {
      // One match past the cap is what tells a list that stopped at it from one that ended.
      const found = await collectContentSearchMatches(tx, terms, options, maxResults + 1, performance.now() + MATCH_BUDGET_MS);
      list = {
        matches: found.matches.slice(0, maxResults),
        capped: found.matches.length > maxResults,
        complete: found.complete,
      };
      writeCachedMatches(key, list);
    }
    const start = (page - 1) * pageSize;
    const documents = list.matches.slice(start, start + pageSize);
    return {
      items: await pageItems(tx, terms, documents, needles),
      page,
      totalItems: list.matches.length,
      totalNovels: new Set(list.matches.map((document) => document.novelId)).size,
      capped: list.capped,
      partial: !list.complete,
    };
  });
}
