import type { QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { normalizeChineseSearchForms } from "@/domains/reading/content-text";
import type { ParsedSearchQuery } from "@/lib/search-query";
import { createSearchSnippet } from "@/lib/search-query";

const MAX_TAG_FILTERS = 20;
const MAX_CANDIDATE_BATCH = 64;

export type PostgresOriginalSearchViewer = {
  id: number;
  role: "user" | "admin";
} | null;

export type PostgresOriginalSearchCursor = {
  sortAt: string;
  id: string;
};

export type PostgresOriginalSearchOptions = {
  viewer: PostgresOriginalSearchViewer;
  titleQuery?: ParsedSearchQuery;
  contentQuery?: ParsedSearchQuery;
  includeTagSlugs?: readonly string[];
  excludeTagSlugs?: readonly string[];
  cursor?: PostgresOriginalSearchCursor;
  offset?: number;
  limit?: number;
};

export type PostgresOriginalSearchTag = {
  id: number;
  slug: string;
  name: string;
  count: number;
};

export type PostgresOriginalSearchItem = {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  snippet: string;
  authorId: number;
  authorName: string;
  authorAvatarPath: string | null;
  wordCount: number;
  unlockSodaPrice: number;
  publishedAt: string;
  updatedAt: string;
  tags: Array<{ id: number; slug: string; name: string }>;
};

export type PostgresOriginalSearchPage = {
  items: PostgresOriginalSearchItem[];
  nextCursor: PostgresOriginalSearchCursor | null;
};

type Builder = { values: unknown[]; parameter(value: unknown): string };
type TagJson = { id: number | string; slug: string; name: string };
type CandidateRow = QueryResultRow & {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  author_id: string;
  author_name: string;
  author_avatar_path: string | null;
  word_count: string;
  unlock_soda_price: string;
  published_at: string;
  updated_at: string;
  sort_at: string;
  tags: TagJson[];
};

function builder(): Builder {
  const values: unknown[] = [];
  return { values, parameter(value) { values.push(value); return `$${values.length}`; } };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return 20;
  if (!Number.isFinite(value)) throw new Error("Invalid original search limit");
  return Math.min(Math.max(Math.floor(value), 1), 50);
}

function normalizeOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_647) {
    throw new Error("Invalid original search offset");
  }
  return offset;
}

function validatedViewer(viewer: PostgresOriginalSearchViewer): PostgresOriginalSearchViewer {
  if (!viewer) return null;
  if (!Number.isSafeInteger(viewer.id) || viewer.id < 1 || viewer.role !== "user" && viewer.role !== "admin") {
    throw new Error("Invalid original search viewer");
  }
  return viewer;
}

function normalizeTagSlugs(values: readonly string[] | undefined, label: string): string[] {
  const tags = [...new Set((values || []).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (tags.length > MAX_TAG_FILTERS || tags.some((tag) => tag.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(tag))) {
    throw new Error(`Invalid original search ${label} tags`);
  }
  return tags;
}

function validateCursor(cursor: PostgresOriginalSearchCursor | undefined): void {
  if (!cursor) return;
  const timestamp = Date.parse(cursor.sortAt);
  if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}T/u.test(cursor.sortAt)) {
    throw new Error("Invalid original search cursor timestamp");
  }
  if (!/^[1-9]\d*$/u.test(cursor.id) || BigInt(cursor.id) > 9_223_372_036_854_775_807n) {
    throw new Error("Invalid original search cursor id");
  }
}

/**
 * Search matches titles, tags and the public body only — the paid body is never
 * indexed and never read here — so a paid article is exactly as discoverable as it is
 * on the public list, and unlocking changes what a reader can open, not what they can
 * find. Visibility therefore mirrors that list: published articles, minus authors the
 * viewer has blocked.
 */
function visibilitySql(sql: Builder, viewer: PostgresOriginalSearchViewer): string {
  if (!viewer) return "TRUE";
  return `NOT EXISTS (
    SELECT 1 FROM user_original_author_blocks blocked
    WHERE blocked.user_id = ${sql.parameter(viewer.id)} AND blocked.author_id = a.author_id
  )`;
}

async function indexedTermSql(sql: Builder, value: string, prefix: "title" | "content"): Promise<string> {
  const forms = await normalizeChineseSearchForms(value, prefix === "title" ? "title" : "content");
  const terms = [...new Set([forms.original, forms.hans].filter((term): term is string => Boolean(term)))];
  if (!terms.length) throw new Error("Original search term normalizes to an empty value");
  return `(${terms.map((term) => {
    const parameter = sql.parameter(escapeLike(term));
    return `(a.${prefix}_search_original LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'
      OR (a.${prefix}_search_hans IS NOT NULL AND a.${prefix}_search_hans LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'))`;
  }).join(" OR ")})`;
}

function tagsSql(sql: Builder, include: string[], exclude: string[]): string[] {
  return [
    ...include.map((slug) => `EXISTS (
      SELECT 1 FROM original_article_tags included_link
      JOIN original_tags included_tag ON included_tag.id = included_link.tag_id
      WHERE included_link.article_id = a.id AND lower(included_tag.slug) = ${sql.parameter(slug)}
    )`),
    ...exclude.map((slug) => `NOT EXISTS (
      SELECT 1 FROM original_article_tags excluded_link
      JOIN original_tags excluded_tag ON excluded_tag.id = excluded_link.tag_id
      WHERE excluded_link.article_id = a.id AND lower(excluded_tag.slug) = ${sql.parameter(slug)}
    )`),
  ];
}

export async function buildPostgresOriginalCandidateQuery(
  options: PostgresOriginalSearchOptions,
  candidateLimit = normalizeLimit(options.limit),
): Promise<SqlQuery> {
  if (options.titleQuery && options.titleQuery.mode !== "title") throw new Error("Original title query must use title mode");
  if (options.contentQuery && options.contentQuery.mode !== "content") throw new Error("Original content query must use content mode");
  if (options.titleQuery && options.titleQuery.syntax !== "simple-and") {
    throw new Error("Original title search only supports simple AND queries");
  }
  if (options.contentQuery && options.contentQuery.syntax !== "simple-and") {
    throw new Error("Original content search only supports simple AND queries");
  }
  if (!Number.isSafeInteger(candidateLimit) || candidateLimit < 1 || candidateLimit > MAX_CANDIDATE_BATCH) {
    throw new Error("Invalid original candidate limit");
  }
  const viewer = validatedViewer(options.viewer);
  validateCursor(options.cursor);
  const offset = normalizeOffset(options.offset);
  if (offset && options.cursor) throw new Error("Original search offset and cursor cannot be combined");
  const include = normalizeTagSlugs(options.includeTagSlugs, "included");
  const exclude = normalizeTagSlugs(options.excludeTagSlugs, "excluded").filter((tag) => !include.includes(tag));
  if (!options.titleQuery && !options.contentQuery && !include.length && !exclude.length) {
    throw new Error("Original search requires a query or tag filter");
  }

  const sql = builder();
  const filters = ["a.status = 'published'", visibilitySql(sql, viewer), ...tagsSql(sql, include, exclude)];
  if (options.titleQuery) {
    for (const term of options.titleQuery.requiredTerms) filters.push(await indexedTermSql(sql, term.value, "title"));
  }
  if (options.contentQuery) {
    for (const term of options.contentQuery.requiredTerms) filters.push(await indexedTermSql(sql, term.value, "content"));
  }
  if (options.cursor) {
    filters.push(`(coalesce(a.published_at, a.created_at), a.id) < (
      ${sql.parameter(options.cursor.sortAt)}::timestamptz, ${sql.parameter(options.cursor.id)}::bigint
    )`);
  }
  const limit = sql.parameter(candidateLimit + 1);
  const offsetSql = offset ? ` OFFSET ${sql.parameter(offset)}::integer` : "";
  return {
    text: `SELECT a.id::text, a.slug, a.title, a.excerpt,
      ${options.contentQuery ? "a.body_markdown" : "''::text AS body_markdown"},
      a.author_id::text, u.display_name AS author_name, u.avatar_path AS author_avatar_path,
      a.word_count::text, a.unlock_soda_price::text,
      coalesce(a.published_at, a.created_at)::text AS published_at,
      a.updated_at::text AS updated_at,
      coalesce(a.published_at, a.created_at)::text AS sort_at,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id', tag.id, 'slug', tag.slug, 'name', tag.name)
        ORDER BY lower(tag.name), tag.id)
        FROM original_article_tags article_tag
        JOIN original_tags tag ON tag.id = article_tag.tag_id
        WHERE article_tag.article_id = a.id), '[]'::jsonb) AS tags
    FROM original_articles a
    JOIN users u ON u.id = a.author_id
    WHERE ${filters.join(" AND ")}
    ORDER BY coalesce(a.published_at, a.created_at) DESC, a.id DESC
    LIMIT ${limit}::integer${offsetSql}`,
    values: sql.values,
  };
}

function safeInteger(value: string | number, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`Invalid PostgreSQL original ${label}`);
  return result;
}

function plainSnippet(text: string, query: ParsedSearchQuery | undefined, fallback: string): string {
  const compact = text
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/[`*_>#~|]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const base = compact || fallback.trim();
  return query ? createSearchSnippet(base, query.highlightTerms, 64, 96) : base.slice(0, 160);
}

function cursorFor(row: CandidateRow): PostgresOriginalSearchCursor {
  return { sortAt: new Date(row.sort_at).toISOString(), id: row.id };
}

function itemFor(row: CandidateRow, contentQuery: ParsedSearchQuery | undefined): PostgresOriginalSearchItem {
  return {
    id: safeInteger(row.id, "article id"),
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    // Cut from the public body: the paid body is not selected, so it cannot leak here.
    snippet: plainSnippet(row.body_markdown, contentQuery, row.excerpt),
    authorId: safeInteger(row.author_id, "author id"),
    authorName: row.author_name,
    authorAvatarPath: row.author_avatar_path,
    wordCount: safeInteger(row.word_count, "word count"),
    unlockSodaPrice: safeInteger(row.unlock_soda_price, "price"),
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    tags: row.tags.map((tag) => ({
      id: safeInteger(tag.id, "tag id"),
      slug: tag.slug,
      name: tag.name,
    })),
  };
}

export async function searchPostgresOriginalArticles(
  executor: SqlExecutor,
  options: PostgresOriginalSearchOptions,
): Promise<PostgresOriginalSearchPage> {
  const limit = normalizeLimit(options.limit);
  const result = await executor.query<CandidateRow>(await buildPostgresOriginalCandidateQuery(options, limit));
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0, limit);
  return {
    items: rows.map((row) => itemFor(row, options.contentQuery)),
    nextCursor: hasMore && rows.length ? cursorFor(rows.at(-1)!) : null,
  };
}

export async function countPostgresOriginalArticles(
  executor: SqlExecutor,
  options: Omit<PostgresOriginalSearchOptions, "cursor" | "limit" | "offset">,
): Promise<number> {
  const candidate = await buildPostgresOriginalCandidateQuery({ ...options, limit: 1 }, 1);
  const fromIndex = candidate.text.indexOf("FROM original_articles a");
  const orderIndex = candidate.text.lastIndexOf("ORDER BY");
  if (fromIndex < 0 || orderIndex <= fromIndex || !candidate.values?.length) {
    throw new Error("Invalid internal PostgreSQL original count query");
  }
  const result = await executor.query<QueryResultRow & { total: string | number }>({
    text: `SELECT COUNT(*)::bigint AS total ${candidate.text.slice(fromIndex, orderIndex).trimEnd()}`,
    values: candidate.values.slice(0, -1),
  });
  return safeInteger(result.rows[0]?.total ?? 0, "search result count");
}

export async function listPostgresOriginalSearchTags(
  executor: SqlExecutor,
  viewer: PostgresOriginalSearchViewer,
): Promise<PostgresOriginalSearchTag[]> {
  const sql = builder();
  const result = await executor.query<QueryResultRow & { id: string; slug: string; name: string; count: string }>({
    text: `SELECT tag.id::text, tag.slug, tag.name, count(DISTINCT a.id)::text AS count
      FROM original_tags tag
      JOIN original_article_tags article_tag ON article_tag.tag_id = tag.id
      JOIN original_articles a ON a.id = article_tag.article_id
      WHERE a.status = 'published' AND ${visibilitySql(sql, validatedViewer(viewer))}
      GROUP BY tag.id, tag.slug, tag.name
      HAVING count(DISTINCT a.id) > 0
      ORDER BY lower(tag.name), tag.id`,
    values: sql.values,
  });
  return result.rows.map((row) => ({
    id: safeInteger(row.id, "tag id"),
    slug: row.slug,
    name: row.name,
    count: safeInteger(row.count, "tag count"),
  }));
}
