import type { QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import type { ParsedSearchQuery } from "@/lib/search-query";
import {
  findNormalizedChineseSearchRanges,
  normalizeChineseSearchForms,
  normalizeChineseSearchNeedles,
} from "./content-text";

const MAX_CANDIDATE_BATCH = 256;
const CONTENT_SEARCH_SNIPPET_LENGTH = 280;
const CONTENT_SEARCH_SNIPPET_LEADING_CONTEXT = 24;

export type PostgresContentSearchCursor = {
  mtimeMs: string;
  documentId: string;
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
  limit?: number;
  offset?: number;
  cursor?: PostgresContentSearchCursor;
  includeTotals?: boolean;
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
  nextCursor: PostgresContentSearchCursor | null;
  totalItems: number | null;
  totalNovels: number | null;
};

type CandidateBlock = { blockNo: number; charStart: number; originalText: string };
type CandidateRow = QueryResultRow & {
  document_id: string | null;
  novel_id: number | null;
  chapter_id: number | null;
  novel_title: string | null;
  chapter_title: string | null;
  content_version: string | null;
  mtime_ms: string | null;
  block_no: number | null;
  char_start: number | null;
  blocks: CandidateBlock[] | null;
  total_items?: string | number;
  total_novels?: string | number;
};
type Builder = { values: unknown[]; parameter(value: unknown): string };

function builder(): Builder {
  const values: unknown[] = [];
  return { values, parameter(value) { values.push(value); return `$${values.length}`; } };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

async function indexedTermSql(sql: Builder, value: string, alias = "b"): Promise<string> {
  // Public search has one contract: normalized keywords ignore punctuation and
  // whitespace, and every term must exist in the same document.
  const forms = await normalizeChineseSearchForms(value, "content");
  const terms = [...new Set([forms.original, forms.hans].filter((term): term is string => Boolean(term)))];
  if (!terms.length) throw new Error("Content search term normalizes to an empty value");
  return `(${terms.map((term) => {
    const parameter = sql.parameter(escapeLike(term));
    return `(${alias}.search_text_original LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'
      OR (${alias}.search_text_hans IS NOT NULL AND ${alias}.search_text_hans LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'))`;
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

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isFinite(value)) throw new Error("Invalid content search limit");
  return Math.min(Math.max(Math.floor(value), 1), 100);
}

function normalizedOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error("Invalid content search offset");
  }
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
}

export async function buildPostgresContentCandidateQuery(
  query: ParsedSearchQuery,
  options: PostgresContentSearchOptions = {},
  candidateLimit = normalizedLimit(options.limit),
): Promise<SqlQuery> {
  if (query.mode !== "content") throw new Error("PostgreSQL content search requires a content query");
  if (query.syntax !== "simple-and") throw new Error("PostgreSQL content search only supports simple AND queries");
  if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > MAX_CANDIDATE_BATCH) {
    throw new Error("Invalid content candidate limit");
  }
  const offsetValue = normalizedOffset(options.offset);
  if (options.cursor && offsetValue > 0) throw new Error("Content search cursor and offset cannot be combined");
  validateCursor(options.cursor);
  const sql = builder();
  const scopeFilters: string[] = [];
  if (!query.requiredTerms.length) throw new Error("PostgreSQL content search requires at least one term");
  const terms = [...query.requiredTerms].sort((left, right) =>
    Array.from(right.normalized).length - Array.from(left.normalized).length);
  if (options.sourceId !== undefined) {
    if (!Number.isSafeInteger(options.sourceId) || options.sourceId < 1 || options.sourceId > 2_147_483_647) {
      throw new Error("Invalid content search source");
    }
    scopeFilters.push(`n.source_id = ${sql.parameter(options.sourceId)}`);
  }
  if (options.novelId !== undefined) {
    if (!Number.isSafeInteger(options.novelId) || options.novelId < 1 || options.novelId > 2_147_483_647) {
      throw new Error("Invalid content search novel");
    }
    scopeFilters.push(`n.id = ${sql.parameter(options.novelId)}`);
  }
  if (options.sourceSlug !== undefined) {
    const sourceSlug = normalizedSlug(options.sourceSlug, "content search source slug");
    if (sourceSlug !== "all") scopeFilters.push(`lower(s.slug) = ${sql.parameter(sourceSlug)}`);
  }
  const excludedSources = normalizedSlugs(options.excludedSourceSlugs, "excluded content search source");
  if (excludedSources.length) scopeFilters.push(`(s.id IS NULL OR lower(s.slug) <> ALL(${sql.parameter(excludedSources)}::text[]))`);
  if (options.titleQuery) {
    if (options.titleQuery.mode !== "title" || options.titleQuery.syntax !== "simple-and") {
      throw new Error("PostgreSQL content title filter only supports simple AND title queries");
    }
    for (const term of options.titleQuery.requiredTerms) scopeFilters.push(await indexedTitleTermSql(sql, term.value));
  }
  const audience = options.audience ?? "public";
  if (audience !== "public" && audience !== "member" && audience !== "admin") throw new Error("Invalid content search audience");
  const tagVisibility = audience === "admin"
    ? "TRUE"
    : audience === "member"
      ? "tag.visibility IN ('public', 'member')"
      : "tag.visibility = 'public'";
  for (const slug of normalizedSlugs(options.includeTagSlugs, "included content search tag")) {
    scopeFilters.push(`EXISTS (
      SELECT 1 FROM novel_tags tagged
      JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = n.id AND tag.slug = ${sql.parameter(slug)} AND ${tagVisibility}
    )`);
  }
  const excludedTags = normalizedSlugs(options.excludeTagSlugs, "excluded content search tag");
  if (excludedTags.length) {
    scopeFilters.push(`NOT EXISTS (
      SELECT 1 FROM novel_tags tagged
      JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = n.id AND tag.slug = ANY(${sql.parameter(excludedTags)}::text[]) AND ${tagVisibility}
    )`);
  }
  // Materialize the comparatively small, access-filtered document set first.
  // Every pg_bigm candidate scan joins it, so a search scoped to one book or
  // source never builds postings for the whole site before applying that scope.
  const termSelects: string[] = [];
  for (let index = 0; index < terms.length; index += 1) {
    const alias = index === 0 ? "b" : `term_block_${index}`;
    const predicate = await indexedTermSql(sql, terms[index].value, alias);
    termSelects.push(`SELECT ${alias}.document_id, ${alias}.generation
        FROM eligible_documents e
        JOIN novel_content_blocks ${alias}
          ON ${alias}.document_id = e.document_id AND ${alias}.generation = e.active_generation
        WHERE ${predicate}`);
  }
  const hitPredicate = await indexedTermSql(sql, terms[0].value, "hit");
  let cursor = "";
  if (options.cursor) {
    cursor = `(q.mtime_ms, q.document_id) < (${sql.parameter(options.cursor.mtimeMs)}, ${sql.parameter(options.cursor.documentId)}::bigint)`;
  }
  const limit = sql.parameter(candidateLimit + 1);
  const offset = offsetValue > 0 ? `OFFSET ${sql.parameter(offsetValue)}` : "";
  const matchedDocs = termSelects.length === 1
    ? `SELECT DISTINCT document_id, generation FROM (${termSelects[0]}) term_hits`
    : termSelects.join("\n      INTERSECT\n      ");
  const scopeSql = scopeFilters.length ? `AND ${scopeFilters.join(" AND ")}` : "";
  const includeTotals = options.includeTotals !== false;
  if (options.includeTotals !== undefined && typeof options.includeTotals !== "boolean") {
    throw new Error("Invalid content search totals option");
  }
  const countsCte = includeTotals ? `, match_counts AS MATERIALIZED (
      SELECT COUNT(*)::bigint AS total_items,
        COUNT(DISTINCT novel_id)::bigint AS total_novels
      FROM qualified
    )` : "";
  const resultJoin = includeTotals
    ? `FROM match_counts mc
    LEFT JOIN page_rows p ON true
    LEFT JOIN LATERAL`
    : `FROM page_rows p
    JOIN LATERAL`;
  const countColumns = includeTotals ? ", mc.total_items, mc.total_novels" : "";
  return {
    text: `WITH eligible_documents AS MATERIALIZED (
      SELECT d.id AS document_id, d.novel_id, d.chapter_id, d.active_generation,
        d.active_content_version AS content_version, n.title AS novel_title,
        CASE WHEN d.chapter_id IS NULL THEN NULL ELSE coalesce(c.title_override, c.title) END AS chapter_title,
        n.mtime_ms
      FROM novel_documents d
      JOIN novels n ON n.id = d.novel_id
      LEFT JOIN novel_sources s ON s.id = n.source_id
      LEFT JOIN novel_chapters c ON c.novel_id = d.novel_id AND c.id = d.chapter_id
      JOIN novel_content_generations g ON g.document_id = d.id AND g.generation = d.active_generation AND g.state = 'published'
      WHERE d.state = 'ready' AND d.active_generation > 0
        AND d.active_content_version = CASE WHEN d.chapter_id IS NULL THEN n.published_content_version ELSE c.published_content_version END
        ${scopeSql}
    ), matched_docs AS MATERIALIZED (
      ${matchedDocs}
    ), qualified AS MATERIALIZED (
      SELECT e.*
      FROM matched_docs m
      JOIN eligible_documents e ON e.document_id = m.document_id AND e.active_generation = m.generation
    )${countsCte}, page_rows AS MATERIALIZED (
      SELECT q.*
      FROM qualified q
      ${cursor ? `WHERE ${cursor}` : ""}
      ORDER BY q.mtime_ms DESC, q.document_id DESC
      LIMIT ${limit} ${offset}
    )
    SELECT p.document_id, p.novel_id, p.chapter_id, p.content_version, p.novel_title, p.chapter_title,
      p.mtime_ms, hit.block_no, hit.char_start${countColumns},
      coalesce((SELECT jsonb_agg(jsonb_build_object('blockNo', source.block_no, 'charStart', source.char_start,
        'originalText', source.original_text)
        ORDER BY source.block_no)
        FROM novel_content_blocks source
        WHERE source.document_id = p.document_id AND source.generation = p.active_generation
          AND source.block_no BETWEEN greatest(hit.block_no - 1, 0) AND hit.block_no + 1), '[]'::jsonb) AS blocks
    ${resultJoin} (
      SELECT hit.block_no, hit.char_start
      FROM novel_content_blocks hit
      WHERE hit.document_id = p.document_id AND hit.generation = p.active_generation
        AND ${hitPredicate}
      ORDER BY hit.block_no
      LIMIT 1
    ) hit ON ${includeTotals ? "p.document_id IS NOT NULL" : "true"}
    ORDER BY p.mtime_ms DESC NULLS LAST, p.document_id DESC NULLS LAST`,
    values: sql.values,
  };
}

async function snippet(
  row: CandidateRow,
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
    charStart: (blocks[0]?.charStart ?? row.char_start ?? 0) + matchStart,
    highlightRanges,
  };
}

function count(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid PostgreSQL content search count");
  return parsed;
}

function cursorFor(row: CandidateRow): PostgresContentSearchCursor {
  return { mtimeMs: row.mtime_ms!, documentId: row.document_id! };
}

export async function searchPostgresContent(
  executor: SqlExecutor,
  query: ParsedSearchQuery,
  options: PostgresContentSearchOptions = {},
): Promise<PostgresContentSearchPage> {
  const limit = normalizedLimit(options.limit);
  // LIKE predicates stay on search_text_* so pg_bigm GIN can drive the scan.
  // Document-level AND is done by intersecting indexed document IDs, not by
  // re-normalizing whole documents in Node.
  const result = await executor.query<CandidateRow>(await buildPostgresContentCandidateQuery(query, options, limit));
  const dataRows = result.rows.filter((row): row is CandidateRow & {
    document_id: string; novel_id: number; novel_title: string; content_version: string;
    mtime_ms: string; block_no: number; char_start: number;
  } => row.document_id !== null && row.novel_id !== null && row.novel_title !== null && row.content_version !== null &&
    row.mtime_ms !== null && row.block_no !== null && row.char_start !== null);
  const hasMore = dataRows.length > limit;
  const rows = dataRows.slice(0, limit);
  const totalsRow = result.rows[0];
  const totalItems = options.includeTotals === false ? null : count(totalsRow?.total_items, rows.length);
  const totalNovels = options.includeTotals === false
    ? null
    : count(totalsRow?.total_novels, new Set(rows.map((row) => row.novel_id)).size);
  const needles = await normalizeChineseSearchNeedles(query.highlightTerms.map((term) => term.value));
  const items = await Promise.all(rows.map(async (row) => {
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
  return { items, nextCursor: hasMore && rows.length ? cursorFor(rows.at(-1)!) : null, totalItems, totalNovels };
}
