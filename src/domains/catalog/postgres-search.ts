import type { QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { normalizeChineseSearchForms } from "@/domains/reading/content-text";
import type { ParsedSearchQuery } from "@/lib/search-query";

export type PostgresCatalogNovel = {
  id: number;
  title: string;
  description: string;
  source_id: number | null;
  storage_mode: "single" | "chapters";
  chapter_count: number;
  access_mode: "inherit" | "soda";
  soda_price: number;
  word_count: number;
  mtime_ms: number;
  updated_at: string;
};

export type PostgresCatalogCursor = {
  sortValue: string | number;
  id: number;
};

export type PostgresCatalogSearchOptions = {
  sourceId?: number | null;
  access?: "all" | "free" | "soda";
  includeTagSlugs?: readonly string[];
  excludeTagSlugs?: readonly string[];
  audience?: "public" | "member" | "admin";
  limit?: number;
  offset?: number;
  cursor?: PostgresCatalogCursor;
  sortBy?: "updated" | "name" | "words";
  sortOrder?: "asc" | "desc";
  /** Stable, parameterized random order used by the catalog's “surprise me” action. */
  randomSeed?: string;
};

export type PostgresCatalogSearchPage = {
  items: PostgresCatalogNovel[];
  nextCursor: PostgresCatalogCursor | null;
};

export type PostgresCatalogSearchTag = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  aliases: string[];
  count: number;
};

export type PostgresCatalogSearchTagGroup = {
  label: string;
  tags: PostgresCatalogSearchTag[];
};

type SqlBuilder = {
  values: unknown[];
  parameter(value: unknown): string;
};

type RawPostgresCatalogNovel = QueryResultRow & {
  id: string | number;
  title: string;
  description: string;
  source_id: string | number | null;
  storage_mode: string;
  chapter_count: string | number;
  access_mode: string;
  soda_price: string | number;
  word_count: string | number;
  mtime_ms: string | number;
  updated_at: Date | string;
  cursor_sort_value: string | number;
};

type RawCatalogSearchTag = QueryResultRow & {
  id: string | number;
  parent_id: string | number | null;
  name: string;
  slug: string;
  aliases: unknown;
  direct_count: string | number;
};

function createSqlBuilder(): SqlBuilder {
  const values: unknown[] = [];
  return {
    values,
    parameter(value: unknown): string {
      values.push(value);
      return `$${values.length}`;
    },
  };
}

/** Escape user text for a LIKE pattern while retaining pg_bigm index eligibility. */
export function escapePostgresLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

async function termSql(builder: SqlBuilder, value: string): Promise<string> {
  const forms = await normalizeChineseSearchForms(value, "title");
  if (!forms.original) throw new Error("Empty search term");
  const terms = [...new Set([forms.original, forms.hans].filter((term): term is string => Boolean(term)))];
  return `(${terms.map((term) => {
    const parameter = builder.parameter(escapePostgresLikePattern(term));
    return `(n.title_search_original LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\' OR (n.title_search_hans IS NOT NULL AND n.title_search_hans LIKE '%' || ${parameter} || '%' ESCAPE E'\\\\'))`;
  }).join(" OR ")})`;
}

function normalizeLimit(value: number | undefined): number {
  const limit = Number.isFinite(value) ? Math.floor(value as number) : 20;
  return Math.min(Math.max(limit, 1), 100);
}

function normalizeOffset(value: number | undefined): number {
  const offset = value ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_647) {
    throw new Error("Invalid catalog search offset");
  }
  return offset;
}

function positiveSafeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid ${label}`);
  return parsed;
}

function nonnegativeSafeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid ${label}`);
  return parsed;
}

function isoTimestamp(value: Date | string, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid ${label}`);
  return date.toISOString();
}

function catalogStorageMode(value: string): PostgresCatalogNovel["storage_mode"] {
  if (value !== "single" && value !== "chapters") throw new Error("Invalid catalog storage mode");
  return value;
}

function catalogAccessMode(value: string): PostgresCatalogNovel["access_mode"] {
  if (value !== "inherit" && value !== "soda") throw new Error("Invalid catalog access mode");
  return value;
}

function toCatalogNovel(row: RawPostgresCatalogNovel): PostgresCatalogNovel {
  return {
    id: positiveSafeInteger(row.id, "catalog novel id"),
    title: row.title,
    description: row.description,
    source_id: row.source_id === null ? null : positiveSafeInteger(row.source_id, "catalog source id"),
    storage_mode: catalogStorageMode(row.storage_mode),
    chapter_count: nonnegativeSafeInteger(row.chapter_count, "catalog chapter count"),
    access_mode: catalogAccessMode(row.access_mode),
    soda_price: nonnegativeSafeInteger(row.soda_price, "catalog soda price"),
    word_count: nonnegativeSafeInteger(row.word_count, "catalog word count"),
    mtime_ms: nonnegativeSafeInteger(row.mtime_ms, "catalog modification time"),
    updated_at: isoTimestamp(row.updated_at, "catalog updated timestamp"),
  };
}

function normalizedTagSlugs(value: readonly string[] | undefined, label: string): string[] {
  if (!value) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error(`Invalid ${label}`);
  return [...new Set(value.map((slug) => {
    if (typeof slug !== "string") throw new Error(`Invalid ${label}`);
    const normalized = slug.normalize("NFKC").trim().toLocaleLowerCase("en-US");
    // Imported SQLite tags can retain underscores in their legacy slugs.
    if (!normalized || normalized.length > 64 || !/^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/u.test(normalized)) {
      throw new Error(`Invalid ${label}`);
    }
    return normalized;
  }))];
}

function tagVisibility(audience: PostgresCatalogSearchOptions["audience"]): string {
  if (audience === undefined || audience === "public") return "tag.visibility = 'public'";
  if (audience === "member") return "tag.visibility IN ('public', 'member')";
  if (audience === "admin") return "TRUE";
  throw new Error("Invalid catalog tag audience");
}

function orderAndCursor(
  builder: SqlBuilder,
  cursor: PostgresCatalogCursor | undefined,
  sortBy: PostgresCatalogSearchOptions["sortBy"],
  sortOrder: PostgresCatalogSearchOptions["sortOrder"],
  randomSeed: string | undefined,
): { orderBy: string; cursorSql: string; sortExpression: string } {
  const normalizedSeed = randomSeed?.normalize("NFKC").trim() ?? "";
  if (normalizedSeed && Array.from(normalizedSeed).length > 64) throw new Error("Invalid catalog random seed");
  const normalizedSort = sortBy ?? "updated";
  if (normalizedSort !== "updated" && normalizedSort !== "name" && normalizedSort !== "words") {
    throw new Error("Invalid catalog sort");
  }
  const normalizedOrder = sortOrder ?? (normalizedSort === "name" ? "asc" : "desc");
  if (normalizedOrder !== "asc" && normalizedOrder !== "desc") throw new Error("Invalid catalog sort order");
  const direction = normalizedSeed ? "ASC" : normalizedOrder === "asc" ? "ASC" : "DESC";
  const operator = direction === "ASC" ? ">" : "<";
  const sortExpression = normalizedSeed
    ? `md5(${builder.parameter(normalizedSeed)} || ':' || n.id::text)`
    : normalizedSort === "name"
    ? `lower(n.title) COLLATE "C"`
    : normalizedSort === "words" ? "n.word_count" : "n.mtime_ms";
  if (!cursor) return { orderBy: `${sortExpression} ${direction}, n.id ${direction}`, cursorSql: "", sortExpression };
  const value = String(cursor.sortValue);
  if (normalizedSeed) {
    if (!/^[0-9a-f]{32}$/u.test(value)) throw new Error("Invalid random catalog cursor");
  } else if (normalizedSort === "name") {
    if (!value || value.includes("\0") || Array.from(value).length > 4_096) {
      throw new Error("Invalid catalog cursor title");
    }
  } else if (!/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > 9_223_372_036_854_775_807n
      || (typeof cursor.sortValue === "number" && !Number.isSafeInteger(cursor.sortValue))) {
    throw new Error("Invalid numeric catalog cursor");
  }
  if (!Number.isSafeInteger(cursor.id) || cursor.id < 1 || cursor.id > 2_147_483_647) {
    throw new Error("Invalid catalog cursor id");
  }
  const sortValue = builder.parameter(value);
  const id = builder.parameter(cursor.id);
  const typedSortValue = normalizedSeed || normalizedSort === "name"
    ? `${sortValue}::text COLLATE "C"`
    : normalizedSort === "words" ? `${sortValue}::integer` : `${sortValue}::bigint`;
  return {
    orderBy: `${sortExpression} ${direction}, n.id ${direction}`,
    cursorSql: `(${sortExpression}, n.id) ${operator} (${typedSortValue}, ${id}::integer)`,
    sortExpression,
  };
}

export async function buildPostgresAdvancedCatalogSearchQuery(
  query: ParsedSearchQuery | undefined,
  options: PostgresCatalogSearchOptions = {},
): Promise<SqlQuery> {
  if (query && query.mode !== "title") throw new Error("Catalog title search requires a title query");
  if (query && query.syntax !== "simple-and") throw new Error("Catalog title search only supports simple AND queries");
  const offset = normalizeOffset(options.offset);
  if (offset && options.cursor) throw new Error("Catalog search offset and cursor cannot be combined");
  const builder = createSqlBuilder();
  const filters: string[] = [];
  for (const required of query?.requiredTerms ?? []) {
    filters.push(await termSql(builder, required.value));
  }
  if (options.sourceId !== undefined && options.sourceId !== null) {
    if (!Number.isSafeInteger(options.sourceId) || options.sourceId < 1 || options.sourceId > 2_147_483_647) {
      throw new Error("Invalid catalog source id");
    }
    filters.push(`n.source_id = ${builder.parameter(options.sourceId)}`);
  }
  if (options.access === "soda") filters.push("n.access_mode = 'soda' AND n.soda_price > 0");
  if (options.access === "free") filters.push("(n.access_mode <> 'soda' OR n.soda_price <= 0)");
  if (options.access !== undefined && options.access !== "all" && options.access !== "free" && options.access !== "soda") {
    throw new Error("Invalid catalog access filter");
  }
  const visibility = tagVisibility(options.audience);
  const includedTags = normalizedTagSlugs(options.includeTagSlugs, "included catalog tags");
  for (const slug of includedTags) {
    filters.push(`EXISTS (
      SELECT 1 FROM novel_tags tagged
      JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = n.id
        AND lower(tag.slug) = ${builder.parameter(slug)}
        AND ${visibility}
    )`);
  }
  const excludedTags = normalizedTagSlugs(options.excludeTagSlugs, "excluded catalog tags")
    .filter((slug) => !includedTags.includes(slug));
  if (excludedTags.length) {
    filters.push(`NOT EXISTS (
      SELECT 1 FROM novel_tags tagged
      JOIN tags tag ON tag.id = tagged.tag_id
      WHERE tagged.novel_id = n.id
        AND lower(tag.slug) = ANY(${builder.parameter(excludedTags)}::text[])
        AND ${visibility}
    )`);
  }
  const { orderBy, cursorSql, sortExpression } = orderAndCursor(
    builder,
    options.cursor,
    options.sortBy,
    options.sortOrder,
    options.randomSeed,
  );
  if (cursorSql) filters.push(cursorSql);
  if (!filters.length) throw new Error("Catalog search requires at least one filter");
  const limit = builder.parameter(normalizeLimit(options.limit) + 1);
  const offsetSql = offset ? ` OFFSET ${builder.parameter(offset)}::integer` : "";
  return {
    text: `
      SELECT n.id, n.title, n.description, n.source_id,
             n.storage_mode, n.chapter_count, n.access_mode, n.soda_price,
             n.word_count, n.mtime_ms, n.updated_at,
             ${sortExpression}::text AS cursor_sort_value
      FROM novels n
      WHERE ${filters.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT ${limit}::integer${offsetSql}`,
    values: builder.values,
  };
}

export async function buildPostgresCatalogTitleSearchQuery(
  query: ParsedSearchQuery,
  options: PostgresCatalogSearchOptions = {},
): Promise<SqlQuery> {
  return buildPostgresAdvancedCatalogSearchQuery(query, options);
}

export async function buildPostgresAdvancedCatalogCountQuery(
  query: ParsedSearchQuery | undefined,
  options: Omit<PostgresCatalogSearchOptions, "cursor" | "limit" | "offset"> = {},
): Promise<SqlQuery> {
  // Random ordering cannot change the count and its SELECT-only seed parameter
  // would become unused after the projection/order are stripped below.
  const { randomSeed: _randomSeed, ...countOptions } = options;
  const pageQuery = await buildPostgresAdvancedCatalogSearchQuery(query, { ...countOptions, limit: 1 });
  const fromIndex = pageQuery.text.indexOf("FROM novels n");
  const orderIndex = pageQuery.text.lastIndexOf("ORDER BY");
  if (fromIndex < 0 || orderIndex <= fromIndex || !pageQuery.values?.length) {
    throw new Error("Invalid internal PostgreSQL catalog count query");
  }
  return {
    text: `SELECT COUNT(*)::bigint AS total ${pageQuery.text.slice(fromIndex, orderIndex).trimEnd()}`,
    values: pageQuery.values.slice(0, -1),
  };
}

export async function searchPostgresAdvancedCatalog(
  executor: SqlExecutor,
  query: ParsedSearchQuery | undefined,
  options: PostgresCatalogSearchOptions = {},
): Promise<PostgresCatalogSearchPage> {
  const limit = normalizeLimit(options.limit);
  const result = await executor.query<RawPostgresCatalogNovel>(
    await buildPostgresAdvancedCatalogSearchQuery(query, options),
  );
  const hasMore = result.rows.length > limit;
  const visibleRows = result.rows.slice(0, limit);
  const items = visibleRows.map(toCatalogNovel);
  const last = visibleRows.at(-1);
  return {
    items,
    nextCursor: hasMore && last ? {
      sortValue: last.cursor_sort_value,
      id: positiveSafeInteger(last.id, "catalog cursor novel id"),
    } : null,
  };
}

export async function searchPostgresCatalogTitles(
  executor: SqlExecutor,
  query: ParsedSearchQuery,
  options: PostgresCatalogSearchOptions = {},
): Promise<PostgresCatalogSearchPage> {
  return searchPostgresAdvancedCatalog(executor, query, options);
}

export async function countPostgresAdvancedCatalog(
  executor: SqlExecutor,
  query: ParsedSearchQuery | undefined,
  options: Omit<PostgresCatalogSearchOptions, "cursor" | "limit" | "offset"> = {},
): Promise<number> {
  const result = await executor.query<QueryResultRow & { total: string | number }>(
    await buildPostgresAdvancedCatalogCountQuery(query, options),
  );
  return nonnegativeSafeInteger(result.rows[0]?.total ?? 0, "catalog result count");
}

function parseAliases(value: unknown): string[] {
  const parsed = typeof value === "string" ? (() => {
    try { return JSON.parse(value) as unknown; } catch { return []; }
  })() : value;
  return Array.isArray(parsed)
    ? parsed.filter((alias): alias is string => typeof alias === "string").slice(0, 20)
    : [];
}

/** One round trip for the visible tag tree, counts, and recursive user hides. */
export async function listPostgresCatalogSearchTagGroups(
  executor: SqlExecutor,
  options: {
    audience?: "public" | "member" | "admin";
    sourceId?: number;
    userId?: number;
  } = {},
): Promise<PostgresCatalogSearchTagGroup[]> {
  const audience = options.audience ?? "public";
  if (audience !== "public" && audience !== "member" && audience !== "admin") {
    throw new Error("Invalid catalog tag audience");
  }
  const sourceId = options.sourceId === undefined
    ? undefined
    : positiveSafeInteger(options.sourceId, "catalog tag source id");
  const userId = options.userId === undefined
    ? undefined
    : positiveSafeInteger(options.userId, "catalog tag user id");
  const builder = createSqlBuilder();
  const hiddenCte = userId === undefined
    ? "hidden(id) AS (SELECT NULL::bigint WHERE FALSE)"
    : `RECURSIVE hidden(id) AS (
         SELECT tag_id FROM user_hidden_tags WHERE user_id = ${builder.parameter(userId)}
         UNION
         SELECT child.id FROM tags child JOIN hidden parent ON child.parent_id = parent.id
       )`;
  const sourceFilter = sourceId === undefined
    ? ""
    : `WHERE n.source_id = ${builder.parameter(sourceId)}`;
  const visibility = audience === "admin"
    ? "TRUE"
    : audience === "member"
      ? "t.visibility IN ('public', 'member')"
      : "t.visibility = 'public'";
  const result = await executor.query<RawCatalogSearchTag>({
    text: `WITH ${hiddenCte},
           counts AS (
             SELECT nt.tag_id, COUNT(*) AS direct_count
             FROM novel_tags nt
             JOIN novels n ON n.id = nt.novel_id
             ${sourceFilter}
             GROUP BY nt.tag_id
           )
           SELECT t.id, t.parent_id, t.name, t.slug, t.aliases,
                  COALESCE(c.direct_count, 0) AS direct_count
           FROM tags t
           LEFT JOIN counts c ON c.tag_id = t.id
           WHERE ${visibility}
             AND NOT EXISTS (SELECT 1 FROM hidden WHERE hidden.id = t.id)
           ORDER BY t.sort_order ASC, lower(t.name) COLLATE "C" ASC, t.id ASC`,
    values: builder.values,
  });
  const tags = result.rows.map((row): PostgresCatalogSearchTag => ({
    id: positiveSafeInteger(row.id, "catalog tag id"),
    parentId: row.parent_id === null ? null : positiveSafeInteger(row.parent_id, "catalog parent tag id"),
    name: row.name,
    slug: row.slug,
    aliases: parseAliases(row.aliases),
    count: nonnegativeSafeInteger(row.direct_count, "catalog tag count"),
  }));
  const roots = tags.filter((tag) => tag.parentId === null);
  const children = new Map<number, PostgresCatalogSearchTag[]>();
  for (const tag of tags) {
    if (tag.parentId === null) continue;
    children.set(tag.parentId, [...(children.get(tag.parentId) ?? []), tag]);
  }
  const rootIds = new Set(roots.map((tag) => tag.id));
  const groups: PostgresCatalogSearchTagGroup[] = roots.flatMap((root) => {
    const visibleChildren = (children.get(root.id) ?? []).filter((tag) => tag.count > 0);
    if (!visibleChildren.length && root.count === 0) return [];
    return [{ label: root.name, tags: visibleChildren.length ? visibleChildren : [root] }];
  });
  const orphaned = tags.filter((tag) => tag.parentId !== null && !rootIds.has(tag.parentId) && tag.count > 0);
  if (orphaned.length) groups.push({ label: "未分组", tags: orphaned });
  return groups;
}
