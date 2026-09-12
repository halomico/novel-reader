import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";

export type PublicNovelStorageMode = "single" | "chapters";
export type PublicNovelAccessMode = "inherit" | "soda";
export type PublicTagVisibility = "public" | "member" | "hidden";
export type PublicTagAudience = "public" | "member" | "admin";
export type PostgresCatalogSort = "updated" | "name" | "words";
export type PostgresCatalogSortOrder = "asc" | "desc";
export type PostgresCatalogAccessFilter = "all" | "free" | "soda";

/**
 * Public catalog read model. Storage paths, file names, content hashes and
 * access-audit fields deliberately do not exist on this boundary.
 */
export type PostgresPublicNovel = {
  id: number;
  title: string;
  description: string;
  sourceId: number | null;
  storageMode: PublicNovelStorageMode;
  chapterCount: number;
  accessMode: PublicNovelAccessMode;
  sodaPrice: number;
  previewChapterCount: number;
  publishedContentVersion: string | null;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  visitCount: number;
  createdAt: string;
  updatedAt: string;
};

/** A library as routing and reading need it: looking one up never counts its novels. */
export type PostgresNovelLibrary = {
  id: number;
  slug: string;
  name: string;
  sortOrder: number;
};

export type PostgresPublicNovelSource = PostgresNovelLibrary & {
  novelCount: number;
};

export type PostgresNovelLibraryScope =
  | { kind: "all"; slug: "all"; source: null }
  | { kind: "source"; slug: string; source: PostgresNovelLibrary };

export type PostgresCatalogCursor = {
  sortBy: PostgresCatalogSort;
  sortOrder: PostgresCatalogSortOrder;
  sortValue: string;
  id: number;
};

export type PostgresCatalogPageOptions = {
  limit?: number;
  offset?: number;
  cursor?: PostgresCatalogCursor;
  sortBy?: PostgresCatalogSort;
  sortOrder?: PostgresCatalogSortOrder;
  /** undefined selects every source; null selects explicitly unassigned books. */
  sourceId?: number | null;
  access?: PostgresCatalogAccessFilter;
};

export type PostgresCatalogPage = {
  items: PostgresPublicNovel[];
  nextCursor: PostgresCatalogCursor | null;
};

export function normalizePostgresCatalogSort(value: string | undefined): PostgresCatalogSort {
  return value === "name" || value === "words" ? value : "updated";
}

export function defaultPostgresCatalogSortOrder(sortBy: PostgresCatalogSort): PostgresCatalogSortOrder {
  return sortBy === "name" ? "asc" : "desc";
}

export function normalizePostgresCatalogSortOrder(
  value: string | undefined,
  sortBy: PostgresCatalogSort,
): PostgresCatalogSortOrder {
  return value === "asc" || value === "desc" ? value : defaultPostgresCatalogSortOrder(sortBy);
}

export function normalizePostgresCatalogAccess(value: string | undefined): PostgresCatalogAccessFilter {
  return value === "free" || value === "soda" ? value : "all";
}

export type PostgresPublicChapter = {
  id: number;
  novelId: number;
  title: string;
  sortOrder: number;
  publishedContentVersion: string | null;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type PostgresChapterCursor = { sortOrder: number; id: number };

export type PostgresChapterPage = {
  items: PostgresPublicChapter[];
  nextCursor: PostgresChapterCursor | null;
};

export type PostgresChapterContext = {
  chapter: PostgresPublicChapter;
  previous: PostgresPublicChapter | null;
  next: PostgresPublicChapter | null;
  /** Zero-based chapter position, matching the existing reader contract. */
  index: number;
  total: number;
};

export type PostgresPublicTag = {
  id: number;
  parentId: number | null;
  name: string;
  slug: string;
  description: string;
  aliases: string[];
  sortOrder: number;
  visibility: PublicTagVisibility;
  isVisible: boolean;
  createdAt: string;
  updatedAt: string;
};

type RawNovel = QueryResultRow & {
  id: number;
  title: string;
  description: string;
  source_id: number | null;
  storage_mode: PublicNovelStorageMode;
  chapter_count: number;
  access_mode: PublicNovelAccessMode;
  soda_price: number;
  preview_chapter_count: number;
  published_content_version: string | null;
  size_bytes: string | number;
  mtime_ms: string | number;
  word_count: number;
  visit_count: string | number;
  created_at: Date | string;
  updated_at: Date | string;
};

type RawCatalogNovel = RawNovel & { sort_value: string };

type RawChapter = QueryResultRow & {
  id: number;
  novel_id: number;
  title: string;
  sort_order: number;
  published_content_version: string | null;
  size_bytes: string | number;
  mtime_ms: string | number;
  word_count: number;
  created_at: Date | string;
  updated_at: Date | string;
};

type RawChapterPageItem = RawChapter & { page_sort_order: number };

const NOVEL_COLUMNS = `
  n.id, n.title, n.description, n.source_id, n.storage_mode,
  n.chapter_count, n.access_mode, n.soda_price, n.preview_chapter_count,
  n.published_content_version, n.size_bytes, n.mtime_ms, n.word_count,
  n.visit_count, n.created_at, n.updated_at`;
const CHAPTER_COLUMNS = `
  c.id, c.novel_id, COALESCE(NULLIF(c.title_override, ''), c.title) AS title,
  COALESCE(c.sort_override, c.sort_order) AS sort_order,
  c.published_content_version, c.size_bytes, c.mtime_ms, c.word_count,
  c.created_at, c.updated_at`;

function positiveInt32(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(value);
}

function nonnegativeInt32(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 2_147_483_647) {
    throw new Error(`Invalid ${label}`);
  }
  return Number(value);
}

function boundedLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`Invalid page limit; expected an integer from 1 to ${maximum}`);
  }
  return value;
}

function safeNonnegativeNumber(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function isoTimestamp(value: Date | string, label: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return date.toISOString();
}

function toNovel(row: RawNovel): PostgresPublicNovel {
  return {
    id: positiveInt32(row.id, "PostgreSQL novel id"),
    title: row.title,
    description: row.description,
    sourceId: row.source_id === null ? null : positiveInt32(row.source_id, "PostgreSQL source id"),
    storageMode: row.storage_mode,
    chapterCount: nonnegativeInt32(row.chapter_count, "PostgreSQL chapter count"),
    accessMode: row.access_mode,
    sodaPrice: nonnegativeInt32(row.soda_price, "PostgreSQL soda price"),
    previewChapterCount: nonnegativeInt32(row.preview_chapter_count, "PostgreSQL preview chapter count"),
    publishedContentVersion: row.published_content_version,
    sizeBytes: safeNonnegativeNumber(row.size_bytes, "novel size"),
    mtimeMs: safeNonnegativeNumber(row.mtime_ms, "novel modification time"),
    wordCount: nonnegativeInt32(row.word_count, "PostgreSQL novel word count"),
    visitCount: safeNonnegativeNumber(row.visit_count, "novel visit count"),
    createdAt: isoTimestamp(row.created_at, "novel creation timestamp"),
    updatedAt: isoTimestamp(row.updated_at, "novel update timestamp"),
  };
}

function toChapter(row: RawChapter): PostgresPublicChapter {
  return {
    id: positiveInt32(row.id, "PostgreSQL chapter id"),
    novelId: positiveInt32(row.novel_id, "PostgreSQL chapter novel id"),
    title: row.title,
    sortOrder: nonnegativeInt32(row.sort_order, "PostgreSQL chapter sort order"),
    publishedContentVersion: row.published_content_version,
    sizeBytes: safeNonnegativeNumber(row.size_bytes, "chapter size"),
    mtimeMs: safeNonnegativeNumber(row.mtime_ms, "chapter modification time"),
    wordCount: nonnegativeInt32(row.word_count, "PostgreSQL chapter word count"),
    createdAt: isoTimestamp(row.created_at, "chapter creation timestamp"),
    updatedAt: isoTimestamp(row.updated_at, "chapter update timestamp"),
  };
}

function catalogOptions(options: PostgresCatalogPageOptions): {
  limit: number;
  offset: number;
  sortBy: PostgresCatalogSort;
  sortOrder: PostgresCatalogSortOrder;
  access: PostgresCatalogAccessFilter;
} {
  const sortBy = options.sortBy ?? "updated";
  if (sortBy !== "updated" && sortBy !== "name" && sortBy !== "words") {
    throw new Error("Invalid catalog sort");
  }
  const sortOrder = options.sortOrder ?? (sortBy === "name" ? "asc" : "desc");
  if (sortOrder !== "asc" && sortOrder !== "desc") throw new Error("Invalid catalog sort order");
  const access = options.access ?? "all";
  if (access !== "all" && access !== "free" && access !== "soda") {
    throw new Error("Invalid catalog access filter");
  }
  const offset = options.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2_147_483_647) {
    throw new Error("Invalid catalog offset");
  }
  if (offset && options.cursor) throw new Error("Catalog offset and cursor cannot be combined");
  return { limit: boundedLimit(options.limit, 24, 100), offset, sortBy, sortOrder, access };
}

function numericCursorValue(value: string, label: string, maximum: bigint): string {
  if (!/^(0|[1-9]\d*)$/u.test(value)) throw new Error(`Invalid ${label}`);
  const parsed = BigInt(value);
  if (parsed > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function validateCatalogCursor(
  cursor: PostgresCatalogCursor,
  sortBy: PostgresCatalogSort,
  sortOrder: PostgresCatalogSortOrder,
): string {
  if (cursor.sortBy !== sortBy || cursor.sortOrder !== sortOrder) {
    throw new Error("Catalog cursor does not match the requested sort");
  }
  positiveInt32(cursor.id, "catalog cursor id");
  if (typeof cursor.sortValue !== "string" || !cursor.sortValue || cursor.sortValue.includes("\0")) {
    throw new Error("Invalid catalog cursor value");
  }
  if (sortBy === "updated") {
    return numericCursorValue(cursor.sortValue, "catalog cursor timestamp", 9_223_372_036_854_775_807n);
  }
  if (sortBy === "words") {
    return numericCursorValue(cursor.sortValue, "catalog cursor word count", 2_147_483_647n);
  }
  if (Array.from(cursor.sortValue).length > 4_096) throw new Error("Invalid catalog cursor title");
  return cursor.sortValue;
}

export function buildPostgresCatalogPageQuery(options: PostgresCatalogPageOptions = {}): SqlQuery {
  const normalized = catalogOptions(options);
  const values: unknown[] = [];
  const parameter = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };
  const filters: string[] = [];
  if (options.sourceId === null) {
    filters.push("n.source_id IS NULL");
  } else if (options.sourceId !== undefined) {
    filters.push(`n.source_id = ${parameter(positiveInt32(options.sourceId, "catalog source id"))}`);
  }
  if (normalized.access === "soda") filters.push("n.access_mode = 'soda' AND n.soda_price > 0");
  if (normalized.access === "free") filters.push("(n.access_mode <> 'soda' OR n.soda_price <= 0)");

  const sortExpression = normalized.sortBy === "updated"
    ? "n.mtime_ms"
    : normalized.sortBy === "words"
      ? "n.word_count"
      : `lower(n.title) COLLATE "C"`;
  const outputSortExpression = normalized.sortBy === "name" ? sortExpression : `${sortExpression}::text`;
  if (options.cursor) {
    const sortValue = validateCatalogCursor(options.cursor, normalized.sortBy, normalized.sortOrder);
    const operator = normalized.sortOrder === "asc" ? ">" : "<";
    const boundSortValue = parameter(sortValue);
    const typedSortValue = normalized.sortBy === "updated"
      ? `${boundSortValue}::bigint`
      : normalized.sortBy === "words"
        ? `${boundSortValue}::integer`
        : `${boundSortValue}::text COLLATE "C"`;
    filters.push(`(${sortExpression}, n.id) ${operator} (${typedSortValue}, ${parameter(options.cursor.id)}::integer)`);
  }
  const direction = normalized.sortOrder === "asc" ? "ASC" : "DESC";
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const limit = parameter(normalized.limit + 1);
  const offset = normalized.offset ? ` OFFSET ${parameter(normalized.offset)}::integer` : "";
  return {
    text: `
      SELECT ${NOVEL_COLUMNS}, ${outputSortExpression} AS sort_value
      FROM novels n
      ${where}
      ORDER BY ${sortExpression} ${direction}, n.id ${direction}
      LIMIT ${limit}::integer${offset}`,
    values,
  };
}

export async function listPostgresCatalogPage(
  executor: SqlExecutor,
  options: PostgresCatalogPageOptions = {},
): Promise<PostgresCatalogPage> {
  const normalized = catalogOptions(options);
  const result = await executor.query<RawCatalogNovel>(buildPostgresCatalogPageQuery(options));
  const visibleRows = result.rows.slice(0, normalized.limit);
  const items = visibleRows.map(toNovel);
  const last = visibleRows.at(-1);
  return {
    items,
    nextCursor: result.rows.length > normalized.limit && last
      ? { sortBy: normalized.sortBy, sortOrder: normalized.sortOrder, sortValue: last.sort_value, id: last.id }
      : null,
  };
}

export async function countPostgresCatalog(
  executor: SqlExecutor,
  options: Pick<PostgresCatalogPageOptions, "sourceId" | "access"> = {},
): Promise<number> {
  const access = options.access ?? "all";
  if (access !== "all" && access !== "free" && access !== "soda") {
    throw new Error("Invalid catalog access filter");
  }
  const values: unknown[] = [];
  const filters: string[] = [];
  if (options.sourceId === null) {
    filters.push("n.source_id IS NULL");
  } else if (options.sourceId !== undefined) {
    values.push(positiveInt32(options.sourceId, "catalog source id"));
    filters.push(`n.source_id = $${values.length}`);
  }
  if (access === "soda") filters.push("n.access_mode = 'soda' AND n.soda_price > 0");
  if (access === "free") filters.push("(n.access_mode <> 'soda' OR n.soda_price <= 0)");
  const sourceShape = options.sourceId === undefined
    ? "all"
    : options.sourceId === null ? "unassigned" : "source";
  const result = await executor.query<QueryResultRow & { total: string | number }>({
    // node-postgres binds a prepared-statement name to one exact SQL string per
    // connection. Filters change the statement shape, so the name must as well.
    name: `catalog-count-v2-${sourceShape}-${access}`,
    text: `SELECT COUNT(*)::bigint AS total FROM novels n${filters.length ? ` WHERE ${filters.join(" AND ")}` : ""}`,
    values,
  });
  return safeNonnegativeNumber(result.rows[0]?.total ?? 0, "catalog count");
}

export async function listPostgresRandomCatalog(
  executor: SqlExecutor,
  seedValue: string,
  options: Pick<PostgresCatalogPageOptions, "sourceId" | "access" | "limit"> = {},
): Promise<PostgresPublicNovel[]> {
  const seed = Array.from(seedValue.normalize("NFKC").trim()).slice(0, 100).join("");
  if (!seed || seed.includes("\0")) throw new Error("Invalid random catalog seed");
  const limit = boundedLimit(options.limit, 24, 100);
  const access = options.access ?? "all";
  if (access !== "all" && access !== "free" && access !== "soda") {
    throw new Error("Invalid catalog access filter");
  }
  const values: unknown[] = [crypto.createHash("sha256").update(seed).digest().readUInt32BE(0)];
  const filters: string[] = [];
  if (options.sourceId === null) {
    filters.push("n.source_id IS NULL");
  } else if (options.sourceId !== undefined) {
    values.push(positiveInt32(options.sourceId, "catalog source id"));
    filters.push(`n.source_id = $${values.length}`);
  }
  if (access === "soda") filters.push("n.access_mode = 'soda' AND n.soda_price > 0");
  if (access === "free") filters.push("(n.access_mode <> 'soda' OR n.soda_price <= 0)");
  const sourceShape = options.sourceId === undefined
    ? "all"
    : options.sourceId === null ? "unassigned" : "source";
  values.push(limit);
  const limitParameter = `$${values.length}`;
  const additional = filters.length ? ` AND ${filters.join(" AND ")}` : "";
  const result = await executor.query<RawNovel>({
    name: `catalog-random-v4-${sourceShape}-${access}`,
    // The pivot walks the per-row random key, never the identity column: ids are sparse
    // and unevenly clustered, so a pivot in id space samples the gaps between books
    // rather than the books themselves. Every row owns one point in [0,1), so this draw
    // is uniform over rows whatever the id distribution looks like. The second branch is
    // the wraparound for a pivot that lands near 1, and the two together read a few
    // hundred indexed rows instead of scanning 1,600.
    text: `WITH pivot AS MATERIALIZED (
        SELECT $1::double precision / 4294967296.0 AS key
      ), candidates AS MATERIALIZED (
        (SELECT ${NOVEL_COLUMNS}, 0 AS random_bucket
         FROM novels n CROSS JOIN pivot
         WHERE n.random_key >= pivot.key${additional}
         ORDER BY n.random_key ASC LIMIT LEAST(${limitParameter}::integer * 8, 200))
        UNION ALL
        (SELECT ${NOVEL_COLUMNS}, 1 AS random_bucket
         FROM novels n CROSS JOIN pivot
         WHERE n.random_key < pivot.key${additional}
         ORDER BY n.random_key ASC LIMIT LEAST(${limitParameter}::integer * 8, 200))
      )
      SELECT id, title, description, source_id, storage_mode, chapter_count,
             access_mode, soda_price, preview_chapter_count, published_content_version,
             size_bytes, mtime_ms, word_count, visit_count, created_at, updated_at
      FROM candidates
      ORDER BY hashtextextended(id::text, $1::bigint), random_bucket, id
      LIMIT ${limitParameter}::integer`,
    values,
  });
  return result.rows.map(toNovel);
}

export async function getPostgresPublicNovel(
  executor: SqlExecutor,
  novelId: number,
): Promise<PostgresPublicNovel | null> {
  const id = positiveInt32(novelId, "novel id");
  const result = await executor.query<RawNovel>({
    text: `SELECT ${NOVEL_COLUMNS} FROM novels n WHERE n.id = $1`,
    values: [id],
  });
  return result.rows[0] ? toNovel(result.rows[0]) : null;
}

type RawLibrary = QueryResultRow & {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
};

type RawSource = RawLibrary & {
  novel_count: string | number;
};

function toLibrary(row: RawLibrary): PostgresNovelLibrary {
  return {
    id: positiveInt32(row.id, "PostgreSQL source id"),
    slug: row.slug,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

function toSource(row: RawSource): PostgresPublicNovelSource {
  return { ...toLibrary(row), novelCount: safeNonnegativeNumber(row.novel_count, "source novel count") };
}

const LIBRARY_COLUMNS = "s.id, s.slug, s.name, s.sort_order";

export async function listPostgresNovelSources(
  executor: SqlExecutor,
  options: { includeEmpty?: boolean } = {},
): Promise<PostgresPublicNovelSource[]> {
  if (options.includeEmpty !== undefined && typeof options.includeEmpty !== "boolean") {
    throw new Error("Invalid include-empty option");
  }
  // Catalog pages render this list on every page turn. Each library counts its novels
  // as an index-only scan of its (source_id, …) range; joining novels to also count by
  // storage mode read every novel row, about 55 ms against a 75k-novel library.
  const result = await executor.query<RawSource>({
    text: `SELECT ${LIBRARY_COLUMNS}, counted.novel_count
      FROM novel_sources s
      CROSS JOIN LATERAL (SELECT count(*) AS novel_count FROM novels n WHERE n.source_id = s.id) counted
      ${options.includeEmpty ? "" : "WHERE counted.novel_count > 0"}
      ORDER BY CASE WHEN lower(s.slug) = 'default' THEN 0 ELSE 1 END,
               s.sort_order ASC, lower(s.name) COLLATE "C" ASC, s.id ASC`,
  });
  return result.rows.map(toSource);
}


export async function getPostgresNovelSourceById(
  executor: SqlExecutor,
  sourceId: number,
): Promise<PostgresNovelLibrary | null> {
  const id = positiveInt32(sourceId, "novel source id");
  const result = await executor.query<RawLibrary>({
    text: `SELECT ${LIBRARY_COLUMNS} FROM novel_sources s WHERE s.id = $1`,
    values: [id],
  });
  return result.rows[0] ? toLibrary(result.rows[0]) : null;
}

export async function resolvePostgresNovelLibraryScope(
  executor: SqlExecutor,
  requestedValue: string | null | undefined,
  configuredDefault = "default",
): Promise<PostgresNovelLibraryScope> {
  const normalize = (value: string | null | undefined): string => String(value || "")
    .normalize("NFKC").trim().toLocaleLowerCase("en-US").slice(0, 64);
  const requested = normalize(requestedValue) || normalize(configuredDefault) || "default";
  if (requested === "all") return { kind: "all", slug: "all", source: null };
  const candidates = [...new Set([requested, normalize(configuredDefault), "default"].filter(Boolean))];
  const result = await executor.query<RawLibrary>({
    text: `SELECT ${LIBRARY_COLUMNS} FROM novel_sources s
      WHERE lower(s.slug) = ANY($1::text[])
      ORDER BY array_position($1::text[], lower(s.slug)), s.id
      LIMIT 1`,
    values: [candidates],
  });
  const source = result.rows[0] ? toLibrary(result.rows[0]) : null;
  if (!source) throw new Error("PostgreSQL default novel library is not initialized");
  return { kind: "source", slug: source.slug, source };
}

export function buildPostgresChapterPageQuery(
  novelId: number,
  options: { limit?: number; cursor?: PostgresChapterCursor } = {},
): SqlQuery {
  const id = positiveInt32(novelId, "novel id");
  const limit = boundedLimit(options.limit, 100, 200);
  const values: unknown[] = [id];
  let cursor = "";
  if (options.cursor) {
    const sortOrder = nonnegativeInt32(options.cursor.sortOrder, "chapter cursor sort order");
    const chapterId = positiveInt32(options.cursor.id, "chapter cursor id");
    values.push(sortOrder, chapterId);
    cursor = "AND (COALESCE(c.sort_override, c.sort_order), c.id) > ($2, $3)";
  }
  values.push(limit + 1);
  return {
    text: `
      SELECT ${CHAPTER_COLUMNS}, COALESCE(c.sort_override, c.sort_order) AS page_sort_order
      FROM novel_chapters c
      WHERE c.novel_id = $1 ${cursor}
      ORDER BY COALESCE(c.sort_override, c.sort_order) ASC, c.id ASC
      LIMIT $${values.length}`,
    values,
  };
}

export async function listPostgresNovelChapters(
  executor: SqlExecutor,
  novelId: number,
  options: { limit?: number; cursor?: PostgresChapterCursor } = {},
): Promise<PostgresChapterPage> {
  const limit = boundedLimit(options.limit, 100, 200);
  const result = await executor.query<RawChapterPageItem>(buildPostgresChapterPageQuery(novelId, options));
  const visibleRows = result.rows.slice(0, limit);
  const last = visibleRows.at(-1);
  return {
    items: visibleRows.map(toChapter),
    nextCursor: result.rows.length > limit && last
      ? { sortOrder: last.page_sort_order, id: last.id }
      : null,
  };
}

export async function getPostgresFirstNovelChapter(
  executor: SqlExecutor,
  novelId: number,
): Promise<PostgresPublicChapter | null> {
  const result = await executor.query<RawChapter>({
    text: `
      SELECT ${CHAPTER_COLUMNS}
      FROM novel_chapters c
      WHERE c.novel_id = $1
      ORDER BY COALESCE(c.sort_override, c.sort_order) ASC, c.id ASC
      LIMIT 1`,
    values: [positiveInt32(novelId, "novel id")],
  });
  return result.rows[0] ? toChapter(result.rows[0]) : null;
}

type RawChapterContext = RawChapter & {
  position: string | number;
  total: string | number;
  previous_id: number | null;
  previous_novel_id: number | null;
  previous_title: string | null;
  previous_sort_order: number | null;
  previous_published_content_version: string | null;
  previous_size_bytes: string | number | null;
  previous_mtime_ms: string | number | null;
  previous_word_count: number | null;
  previous_created_at: Date | string | null;
  previous_updated_at: Date | string | null;
  next_id: number | null;
  next_novel_id: number | null;
  next_title: string | null;
  next_sort_order: number | null;
  next_published_content_version: string | null;
  next_size_bytes: string | number | null;
  next_mtime_ms: string | number | null;
  next_word_count: number | null;
  next_created_at: Date | string | null;
  next_updated_at: Date | string | null;
};

function adjacentChapter(row: RawChapterContext, side: "previous" | "next"): PostgresPublicChapter | null {
  const adjacentId = row[`${side}_id`];
  if (adjacentId === null) return null;
  return toChapter({
    id: adjacentId,
    novel_id: row[`${side}_novel_id`]!,
    title: row[`${side}_title`]!,
    sort_order: row[`${side}_sort_order`]!,
    published_content_version: row[`${side}_published_content_version`],
    size_bytes: row[`${side}_size_bytes`]!,
    mtime_ms: row[`${side}_mtime_ms`]!,
    word_count: row[`${side}_word_count`]!,
    created_at: row[`${side}_created_at`]!,
    updated_at: row[`${side}_updated_at`]!,
  });
}

export async function getPostgresChapterContext(
  executor: SqlExecutor,
  novelId: number,
  chapterId: number,
): Promise<PostgresChapterContext | null> {
  const id = positiveInt32(novelId, "novel id");
  const cid = positiveInt32(chapterId, "chapter id");

  const result = await executor.query<RawChapterContext>({
    text: `
      WITH current AS (
        SELECT ${CHAPTER_COLUMNS}, COALESCE(c.sort_override, c.sort_order) AS effective_sort_order
        FROM novel_chapters c
        WHERE c.novel_id = $1 AND c.id = $2
      ),
      stats AS (
        SELECT
          COUNT(*)::bigint AS total,
          (SELECT COUNT(*)::bigint + 1 FROM novel_chapters
           WHERE novel_id = $1
             AND (COALESCE(sort_override, sort_order), id) <
                 ((SELECT effective_sort_order FROM current), $2)) AS position
        FROM novel_chapters WHERE novel_id = $1
      ),
      previous AS (
        SELECT ${CHAPTER_COLUMNS}
        FROM novel_chapters c, current curr
        WHERE c.novel_id = $1
          AND (COALESCE(c.sort_override, c.sort_order), c.id) < (curr.effective_sort_order, curr.id)
        ORDER BY COALESCE(c.sort_override, c.sort_order) DESC, c.id DESC
        LIMIT 1
      ),
      next AS (
        SELECT ${CHAPTER_COLUMNS}
        FROM novel_chapters c, current curr
        WHERE c.novel_id = $1
          AND (COALESCE(c.sort_override, c.sort_order), c.id) > (curr.effective_sort_order, curr.id)
        ORDER BY COALESCE(c.sort_override, c.sort_order) ASC, c.id ASC
        LIMIT 1
      )
      SELECT
        curr.id, curr.novel_id, curr.title, curr.sort_order,
        curr.published_content_version, curr.size_bytes, curr.mtime_ms,
        curr.word_count, curr.created_at, curr.updated_at,
        s.position, s.total,
        p.id AS previous_id, p.novel_id AS previous_novel_id, p.title AS previous_title,
        p.sort_order AS previous_sort_order, p.published_content_version AS previous_published_content_version,
        p.size_bytes AS previous_size_bytes, p.mtime_ms AS previous_mtime_ms,
        p.word_count AS previous_word_count, p.created_at AS previous_created_at,
        p.updated_at AS previous_updated_at,
        n.id AS next_id, n.novel_id AS next_novel_id, n.title AS next_title,
        n.sort_order AS next_sort_order, n.published_content_version AS next_published_content_version,
        n.size_bytes AS next_size_bytes, n.mtime_ms AS next_mtime_ms,
        n.word_count AS next_word_count, n.created_at AS next_created_at,
        n.updated_at AS next_updated_at
      FROM current curr
      CROSS JOIN stats s
      LEFT JOIN previous p ON TRUE
      LEFT JOIN next n ON TRUE`,
    values: [id, cid],
  });
  const row = result.rows[0];
  if (!row) return null;
  const position = safeNonnegativeNumber(row.position, "chapter position");
  const total = safeNonnegativeNumber(row.total, "chapter total");
  return {
    chapter: toChapter(row),
    previous: adjacentChapter(row, "previous"),
    next: adjacentChapter(row, "next"),
    index: Math.max(position - 1, 0),
    total,
  };
}

type RawTag = QueryResultRow & {
  novel_id: number;
  id: string | number;
  parent_id: string | number | null;
  name: string;
  slug: string;
  description: string;
  aliases: unknown;
  sort_order: number;
  visibility: PublicTagVisibility;
  created_at: Date | string;
  updated_at: Date | string;
};

function jsonAliases(value: unknown): string[] {
  const parsed = typeof value === "string" ? (() => {
    try { return JSON.parse(value) as unknown; } catch { return []; }
  })() : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string").slice(0, 20);
}

function toTag(row: RawTag): PostgresPublicTag {
  return {
    id: safeNonnegativeNumber(row.id, "tag id"),
    parentId: row.parent_id === null ? null : safeNonnegativeNumber(row.parent_id, "tag parent id"),
    name: row.name,
    slug: row.slug,
    description: row.description,
    aliases: jsonAliases(row.aliases),
    sortOrder: row.sort_order,
    visibility: row.visibility,
    isVisible: row.visibility !== "hidden",
    createdAt: isoTimestamp(row.created_at, "tag creation timestamp"),
    updatedAt: isoTimestamp(row.updated_at, "tag update timestamp"),
  };
}

export async function listPostgresTagsForNovels(
  executor: SqlExecutor,
  novelIds: readonly number[],
  options: { audience?: PublicTagAudience } = {},
): Promise<Map<number, PostgresPublicTag[]>> {
  if (novelIds.length > 500) throw new Error("A tag batch cannot exceed 500 novels");
  const ids = [...new Set(novelIds.map((id) => positiveInt32(id, "tag batch novel id")))];
  const audience = options.audience ?? "public";
  if (audience !== "public" && audience !== "member" && audience !== "admin") {
    throw new Error("Invalid tag audience");
  }
  const result = new Map(ids.map((id) => [id, [] as PostgresPublicTag[]]));
  if (!ids.length) return result;
  const visibility = audience === "admin"
    ? "TRUE"
    : audience === "member"
      ? "t.visibility IN ('public', 'member')"
      : "t.visibility = 'public'";
  const rows = await executor.query<RawTag>({
    text: `
      SELECT requested.novel_id, t.id, t.parent_id, t.name, t.slug,
             t.description, t.aliases, t.sort_order, t.visibility,
             t.created_at, t.updated_at
      FROM unnest($1::integer[]) WITH ORDINALITY AS requested(novel_id, ordinal)
      INNER JOIN novel_tags nt ON nt.novel_id = requested.novel_id
      INNER JOIN tags t ON t.id = nt.tag_id
      WHERE ${visibility}
      ORDER BY requested.ordinal ASC, t.sort_order ASC,
               lower(t.name) COLLATE "C" ASC, t.id ASC`,
    values: [ids],
  });
  for (const row of rows.rows) {
    const novelId = positiveInt32(row.novel_id, "PostgreSQL tagged novel id");
    result.get(novelId)?.push(toTag(row));
  }
  return result;
}
