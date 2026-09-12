import type { QueryResultRow } from "pg";
import { postgresQueryTimeoutMs, withTransaction, type SqlExecutor, type SqlQuery } from "@/core/db/postgres";
import type { ParsedSearchQuery } from "@/lib/search-query";
import {
  findNormalizedChineseSearchRanges,
  normalizeChineseSearchForms,
  normalizeChineseSearchNeedles,
} from "./content-text";

/*
 * Full-text search over `novel_search_documents`, one row per published document holding
 * that document's whole normalized text.
 *
 * Everything here follows from one property of a bigram index built at document rather
 * than block granularity: a keyword's posting list is as long as the number of documents
 * that contain it, not the number of 1200-character blocks. A word in 96% of the library
 * is tens of thousands of postings instead of millions, so the index can be asked how
 * many documents match and which ones, and answer from the index alone.
 *
 * That removes the machinery the block index needed. There is no result cap, no time
 * budget, no pair of competing scan strategies, and no cached result list: a page costs
 * what that page costs, and the total beside it is counted, not guessed at.
 *
 * Two things still need care.
 *
 * 1. Recheck is disabled for the session. pg_bigm would otherwise re-evaluate every LIKE
 *    against the candidate's text, which means detoasting each matching document -- the
 *    exact work the index exists to avoid. A two-character keyword is a single bigram, so
 *    the index answers it exactly and recheck was never needed for it. A longer keyword
 *    gets a superset, which this module verifies itself (point 2). The same applies to a
 *    book-title filter riding along in the same statement, so that filter carries its own
 *    verification.
 *
 * 2. Verification is deferred until a page is being filled, never applied to the whole
 *    candidate set. Written the obvious way -- the check in the same WHERE as the
 *    keywords -- PostgreSQL evaluates it below the ordering and reads every candidate's
 *    text: measured at 563 MB of I/O for a query whose every candidate matched. Ordering
 *    the candidates in a MATERIALIZED CTE first and verifying above it costs 785 pages
 *    for the same answer.
 */

/** Documents whose text may be read to verify a keyword the index could only approximate.
 *  Reaching this means a keyword's bigrams are common while the keyword itself is not --
 *  a typo, usually -- and the honest answer is the short list this produces. */
const VERIFY_SCAN_LIMIT = 2_000;
/** A page deeper than this is not reachable through the UI; it exists so a crafted
 *  request cannot ask PostgreSQL to count off a million rows. */
const MAX_PAGE = 100_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const CONTENT_SEARCH_SNIPPET_LENGTH = 280;
const CONTENT_SEARCH_SNIPPET_LEADING_CONTEXT = 24;
const MIN_STATEMENT_TIMEOUT_MS = 20;
/** Left for the round trip, so the server cancels a statement before node-postgres
 *  abandons it on its own timer, which would fail the search instead of ending it. */
const STATEMENT_TIMEOUT_MARGIN_MS = 500;

export type PostgresContentSearchOptions = {
  novelId?: number;
  sourceId?: number;
  sourceSlug?: string;
  excludedSourceSlugs?: readonly string[];
  includeTagSlugs?: readonly string[];
  excludeTagSlugs?: readonly string[];
  titleQuery?: ParsedSearchQuery;
  audience?: "public" | "member" | "admin";
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
  totalItems: number;
  totalNovels: number;
  /** The totals are an upper bound rather than a count. True when some keyword spans more
   *  than one bigram, so the index admitted documents that only the listed rows were
   *  checked against. The rows themselves are exact either way. */
  estimated: boolean;
};

/** A search holds one connection for the two statements it runs, so it runs in a
 *  transaction: the page must be described by the same snapshot that counted it. */
export type ContentSearchTransaction = <T>(operation: (executor: SqlExecutor) => Promise<T>) => Promise<T>;

export const readOnlyContentSearchTransaction: ContentSearchTransaction = (operation) =>
  withTransaction(operation, { role: "web", readOnly: true });

export type ContentSearchTerm = {
  /** The normalized form actually searched for: one form, already Hans-folded. */
  text: string;
  length: number;
  /** exact: one bigram, which the index answers with no false positives.
   *  verify: several bigrams, so the index returns a superset to be checked.
   *  unindexed: a single character has no bigram and cannot narrow anything. */
  kind: "exact" | "verify" | "unindexed";
};

type Builder = { values: unknown[]; parameter(value: unknown): string };

function builder(): Builder {
  const values: unknown[] = [];
  return { values, parameter(value) { values.push(value); return `$${values.length}`; } };
}

/** Escapes the LIKE wildcards for the default escape character, so no ESCAPE clause is
 *  needed and pg_bigm sees the pattern shape it optimizes. Content normalization already
 *  strips every one of these as punctuation; this keeps that from being load-bearing. */
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
    const forms = await normalizeChineseSearchForms(required.value, "content");
    // The index stores the converted form only, so a Traditional document and a
    // Simplified query meet here rather than in a second column and a second index.
    const text = forms.hans ?? forms.original;
    if (!text) throw new Error("Content search term normalizes to an empty value");
    if (seen.has(text)) continue;
    seen.add(text);
    const length = Array.from(text).length;
    terms.push({ text, length, kind: length === 1 ? "unindexed" : length === 2 ? "exact" : "verify" });
  }
  // Longest first: the rarest keyword narrows the candidate set most, and the same term
  // locates each result's excerpt.
  terms.sort((left, right) => right.length - left.length);
  if (terms[0] === undefined || terms[0].kind === "unindexed") {
    throw new Error("Content search requires a keyword of at least two characters");
  }
  return terms;
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

function normalizedPageSize(value: number | undefined): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid content search page size");
  return Math.min(value, MAX_PAGE_SIZE);
}

function normalizedPage(value: number | undefined): number {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_PAGE) throw new Error("Invalid content search page");
  return value;
}

/** Book titles keep both scripts in their own columns, so both are matched. With recheck
 *  off the index result is a superset for anything longer than one bigram, so the exact
 *  test rides along; a title is short and always inline, which makes it free. */
async function titleFilterSql(sql: Builder, value: string): Promise<string> {
  const forms = await normalizeChineseSearchForms(value, "title");
  const texts = [...new Set([forms.original, forms.hans].filter((text): text is string => Boolean(text)))];
  if (!texts.length) throw new Error("Title search term normalizes to an empty value");
  return `(${texts.map((text) => {
    const pattern = sql.parameter(escapeLike(text));
    const exact = sql.parameter(text);
    return `((n.title_search_original LIKE '%' || ${pattern} || '%' AND strpos(n.title_search_original, ${exact}) > 0)
      OR (n.title_search_hans IS NOT NULL AND n.title_search_hans LIKE '%' || ${pattern} || '%'
        AND strpos(n.title_search_hans, ${exact}) > 0))`;
  }).join(" OR ")})`;
}

/**
 * Everything a document must satisfy besides its keywords. Library membership sits on the
 * search row itself; tags and titles are correlated subqueries against the catalog, which
 * keeps them filters on the driving relation instead of joins the planner may reorder
 * ahead of the ordering that makes the limit stop the scan.
 */
async function scopeFilters(sql: Builder, options: PostgresContentSearchOptions): Promise<string[]> {
  const filters: string[] = [];
  if (options.novelId !== undefined) {
    filters.push(`s.novel_id = ${sql.parameter(positiveInt32(options.novelId, "content search novel"))}`);
  }
  if (options.sourceId !== undefined) {
    filters.push(`s.source_id = ${sql.parameter(positiveInt32(options.sourceId, "content search source"))}`);
  }
  if (options.sourceSlug !== undefined) {
    const slug = normalizedSlug(options.sourceSlug, "content search source slug");
    if (slug !== "all") {
      filters.push(`s.source_id = (SELECT lookup.id FROM novel_sources lookup WHERE lower(lookup.slug) = ${sql.parameter(slug)})`);
    }
  }
  const excludedSources = normalizedSlugs(options.excludedSourceSlugs, "excluded content search source");
  if (excludedSources.length) {
    filters.push(`(s.source_id IS NULL OR s.source_id <> ALL(coalesce((
      SELECT array_agg(excluded.id) FROM novel_sources excluded
      WHERE lower(excluded.slug) = ANY(${sql.parameter(excludedSources)}::text[])
    ), '{}'::integer[])))`);
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
      SELECT 1 FROM novel_tags tagged JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = s.novel_id AND tag.slug = ${sql.parameter(slug)} AND ${tagVisibility}
    )`);
  }
  const excludedTags = normalizedSlugs(options.excludeTagSlugs, "excluded content search tag");
  if (excludedTags.length) {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM novel_tags tagged JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = s.novel_id AND tag.slug = ANY(${sql.parameter(excludedTags)}::text[]) AND ${tagVisibility}
    )`);
  }
  if (options.titleQuery) {
    if (options.titleQuery.mode !== "title" || options.titleQuery.syntax !== "simple-and") {
      throw new Error("PostgreSQL content title filter only supports simple AND title queries");
    }
    const titleTerms: string[] = [];
    for (const term of options.titleQuery.requiredTerms) titleTerms.push(await titleFilterSql(sql, term.value));
    filters.push(`EXISTS (SELECT 1 FROM novels n WHERE n.id = s.novel_id AND ${titleTerms.join("\n      AND ")})`);
  }
  return filters;
}

/**
 * One statement producing the exact number of matching documents and novels, plus the
 * ids on the requested page.
 *
 * `candidates` is MATERIALIZED so the keyword scan runs once and the three readers below
 * it rescan a tuplestore that is already in the answer's order. Verification, when a
 * keyword needs it, hangs off a LATERAL over that tuplestore: LATERAL is the one join
 * PostgreSQL will not reorder, so the candidate order survives and the page limit stops
 * the scan instead of every candidate being read first.
 */
export async function buildContentSearchCandidateQuery(
  terms: readonly ContentSearchTerm[],
  options: PostgresContentSearchOptions,
  window: { limit: number; offset: number },
): Promise<SqlQuery> {
  if (!Number.isSafeInteger(window.limit) || window.limit < 1) throw new Error("Invalid content search limit");
  if (!Number.isSafeInteger(window.offset) || window.offset < 0) throw new Error("Invalid content search offset");
  const sql = builder();
  const indexed = terms.filter((term) => term.kind !== "unindexed");
  const verified = terms.filter((term) => term.kind !== "exact");
  if (!indexed.length) throw new Error("Content search requires a keyword of at least two characters");
  // A single character has no bigram, so naming it here would only turn the scan
  // sequential; it is checked with the other verifications instead.
  const keywordFilters = indexed.map((term) => `s.search_text LIKE '%' || ${sql.parameter(escapeLike(term.text))} || '%'`);
  const scope = await scopeFilters(sql, options);
  const page = verified.length
    ? `SELECT scanned.document_id FROM (
        SELECT c.document_id FROM candidates c LIMIT ${sql.parameter(window.offset + window.limit + VERIFY_SCAN_LIMIT)}
      ) scanned
      JOIN LATERAL (
        SELECT 1 FROM novel_search_documents v
        WHERE v.document_id = scanned.document_id
          AND ${verified.map((term) => `strpos(v.search_text, ${sql.parameter(term.text)}) > 0`).join("\n          AND ")}
      ) present ON true
      LIMIT ${sql.parameter(window.limit)} OFFSET ${sql.parameter(window.offset)}`
    : `SELECT c.document_id FROM candidates c
      LIMIT ${sql.parameter(window.limit)} OFFSET ${sql.parameter(window.offset)}`;
  return {
    text: `WITH candidates AS MATERIALIZED (
      SELECT s.document_id, s.novel_id
      FROM novel_search_documents s
      WHERE ${[...keywordFilters, ...scope].join("\n        AND ")}
      ORDER BY s.document_id DESC
    ),
    page AS (${page})
    SELECT (SELECT count(*) FROM candidates)::text AS total_items,
      (SELECT count(DISTINCT novel_id) FROM candidates)::text AS total_novels,
      coalesce((SELECT array_agg(document_id::text ORDER BY document_id DESC) FROM page), '{}'::text[]) AS ids`,
    values: sql.values,
  };
}

type PageRow = QueryResultRow & {
  document_id: string;
  novel_id: number;
  chapter_id: number | null;
  novel_title: string;
  chapter_title: string | null;
  content_version: string;
  block_no: number;
  blocks: CandidateBlock[] | null;
};
type MatchedDocument = {
  documentId: string;
  novelId: number;
  chapterId: number | null;
  novelTitle: string;
  chapterTitle: string | null;
  contentVersion: string;
  blockNo: number;
  blocks: CandidateBlock[];
};
type CandidateBlock = { blockNo: number; charStart: number; originalText: string };

/**
 * Describes the page's documents: catalog titles, and the original text around the match.
 *
 * The match is located in the document's normalized text and mapped back to a block
 * through `block_starts`, so nothing has to scan the document's blocks looking for the
 * keyword. Three blocks are returned rather than one, because the excerpt window reaches
 * past the block the keyword starts in.
 */
export function buildContentSearchPageQuery(documentIds: readonly string[], anchor: string): SqlQuery {
  if (!documentIds.length) throw new Error("Content search page requires at least one document");
  if (documentIds.some((id) => !/^[1-9]\d{0,18}$/u.test(id))) throw new Error("Invalid content search document id");
  return {
    text: `SELECT s.document_id::text AS document_id, s.novel_id, d.chapter_id, n.title AS novel_title,
        CASE WHEN d.chapter_id IS NULL THEN NULL ELSE coalesce(c.title_override, c.title) END AS chapter_title,
        d.active_content_version AS content_version, located.block_no,
        coalesce((
          SELECT jsonb_agg(jsonb_build_object('blockNo', b.block_no, 'charStart', b.char_start,
            'originalText', b.original_text) ORDER BY b.block_no)
          FROM novel_content_blocks b
          WHERE b.document_id = s.document_id AND b.generation = s.generation
            AND b.block_no BETWEEN greatest(located.block_no - 1, 0) AND located.block_no + 1
        ), '[]'::jsonb) AS blocks
      FROM novel_search_documents s
      JOIN novel_documents d ON d.id = s.document_id
      JOIN novels n ON n.id = s.novel_id
      LEFT JOIN novel_chapters c ON c.novel_id = s.novel_id AND c.id = d.chapter_id
      JOIN LATERAL (
        SELECT greatest((
          SELECT count(*) FROM unnest(s.block_starts) AS start_offset
          WHERE start_offset <= greatest(strpos(s.search_text, $2) - 1, 0)
        ) - 1, 0)::integer AS block_no
      ) located ON true
      WHERE s.document_id = ANY($1::bigint[])
      ORDER BY s.document_id DESC`,
    values: [documentIds, anchor],
  };
}

async function snippet(
  row: MatchedDocument,
  needles: readonly string[],
): Promise<{ text: string; charStart: number; highlightRanges: Array<{ start: number; end: number }> }> {
  const blocks = row.blocks;
  const text = blocks.map((block) => block.originalText).join("");
  const currentBlockIndex = blocks.findIndex((block) => block.blockNo === row.blockNo);
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
    charStart: (blocks[0]?.charStart ?? 0) + matchStart,
    highlightRanges,
  };
}

async function pageItems(
  documents: readonly MatchedDocument[],
  needles: readonly string[],
): Promise<PostgresContentSearchItem[]> {
  return Promise.all(documents.map(async (document) => {
    const excerpt = await snippet(document, needles);
    return {
      documentId: document.documentId,
      novelId: document.novelId,
      chapterId: document.chapterId,
      novelTitle: document.novelTitle,
      chapterTitle: document.chapterTitle,
      contentVersion: document.contentVersion,
      blockNo: document.blockNo,
      charStart: excerpt.charStart,
      snippet: excerpt.text,
      highlightRanges: excerpt.highlightRanges,
    };
  }));
}

/**
 * Turns off pg_bigm's recheck for this transaction, and caps how long a statement may
 * run. `current_setting(..., true)` returns NULL where the extension is absent, which is
 * how a development database on pg_trgm skips the setting instead of failing on it --
 * pg_trgm rechecks unconditionally, so it is exact there without this.
 */
async function prepareSearchSession(executor: SqlExecutor): Promise<void> {
  const timeout = Math.max(MIN_STATEMENT_TIMEOUT_MS, postgresQueryTimeoutMs("web") - STATEMENT_TIMEOUT_MARGIN_MS);
  await executor.query({
    text: `SELECT set_config('jit', 'off', true),
      set_config('statement_timeout', $1, true),
      (SELECT set_config('pg_bigm.enable_recheck', 'off', true)
       WHERE current_setting('pg_bigm.enable_recheck', true) IS NOT NULL)`,
    values: [`${Math.ceil(timeout)}ms`],
  });
}

export async function searchPostgresContent(
  transaction: ContentSearchTransaction,
  query: ParsedSearchQuery,
  options: PostgresContentSearchOptions,
): Promise<PostgresContentSearchPage> {
  const pageSize = normalizedPageSize(options.pageSize);
  const page = normalizedPage(options.page);
  const terms = await planContentSearchTerms(query);
  const candidateQuery = await buildContentSearchCandidateQuery(terms, options, {
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const needles = await normalizeChineseSearchNeedles(query.highlightTerms.map((term) => term.value));
  const found = await transaction(async (tx) => {
    await prepareSearchSession(tx);
    const summary = await tx.query<QueryResultRow & { total_items: string; total_novels: string; ids: string[] }>(candidateQuery);
    const row = summary.rows[0];
    const ids = row?.ids ?? [];
    const documents = ids.length
      ? (await tx.query<PageRow>(buildContentSearchPageQuery(ids, terms[0].text))).rows.map<MatchedDocument>((hit) => ({
          documentId: hit.document_id,
          novelId: hit.novel_id,
          chapterId: hit.chapter_id,
          novelTitle: hit.novel_title,
          chapterTitle: hit.chapter_title,
          contentVersion: hit.content_version,
          blockNo: hit.block_no,
          blocks: hit.blocks || [],
        }))
      : [];
    return { documents, totalItems: Number(row?.total_items ?? 0), totalNovels: Number(row?.total_novels ?? 0) };
  });
  return {
    items: await pageItems(found.documents, needles),
    page,
    totalItems: found.totalItems,
    totalNovels: found.totalNovels,
    estimated: terms.some((term) => term.kind !== "exact"),
  };
}
