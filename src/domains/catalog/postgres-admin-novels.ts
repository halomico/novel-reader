import { createHash } from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { normalizeChineseSearchForms } from "@/domains/reading/content-text";

export type AdminBookSortKey = "title" | "file_name" | "size_bytes" | "word_count" | "updated_at" | "visit_count" | "last_accessed_at";
export type AdminBookSortDir = "asc" | "desc";
export type NovelStorageMode = "single" | "chapters";
export type NovelAccessMode = "inherit" | "soda";

export type AdminNovel = {
  id: number;
  title: string;
  description: string;
  file_name: string;
  relative_path: string;
  source_id: number | null;
  storage_mode: NovelStorageMode;
  chapter_count: number;
  access_mode: NovelAccessMode;
  soda_price: number;
  preview_chapter_count: number;
  content_hash: string | null;
  published_content_version: string | null;
  size_bytes: number;
  mtime_ms: number;
  word_count: number;
  visit_count: number;
  last_accessed_at: string | null;
  last_accessed_ip: string | null;
  last_accessed_user_agent: string | null;
  created_at: string;
  updated_at: string;
  recommend_count: number;
};

export type AdminBookListResult = {
  books: AdminNovel[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalPages: number;
  query: string;
  sort: AdminBookSortKey;
  dir: AdminBookSortDir;
  message?: string;
};

export type NovelSource = {
  id: number;
  slug: string;
  name: string;
  relativePath: string;
  sortOrder: number;
  novelCount: number;
  singleNovelCount: number;
  chapterNovelCount: number;
  createdAt: string;
  updatedAt: string;
};

export type NovelChapter = {
  id: number;
  novelId: number;
  title: string;
  relativePath: string;
  sortOrder: number;
  contentHash: string | null;
  publishedContentVersion: string | null;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type NovelChapterPage = {
  chapters: NovelChapter[];
  page: number;
  pageSize: number;
  totalChapters: number;
  totalPages: number;
};

export type NovelChapterUpdate = { id: number; title: string; sortOrder: number };
export type PinnedNovel = { id: number; title: string; sortOrder: number; createdAt: string };

type RawNovel = QueryResultRow & {
  id: number; title: string; description: string; file_name: string; relative_path: string;
  source_id: number | null; storage_mode: NovelStorageMode; chapter_count: number;
  access_mode: NovelAccessMode; soda_price: number; preview_chapter_count: number;
  content_hash: string | null; published_content_version: string | null;
  size_bytes: string | number; mtime_ms: string | number; word_count: number;
  visit_count: string | number; last_accessed_at: Date | string | null;
  last_accessed_ip: string | null; last_accessed_user_agent: string | null;
  created_at: Date | string; updated_at: Date | string; recommend_count: string | number;
};

type RawSource = QueryResultRow & {
  id: number; slug: string; name: string; relative_path: string; sort_order: number;
  novel_count: string | number; single_novel_count: string | number; chapter_novel_count: string | number;
  created_at: Date | string; updated_at: Date | string;
};

type RawChapter = QueryResultRow & {
  id: number; novel_id: number; title: string; relative_path: string; sort_order: number;
  content_hash: string | null; published_content_version: string | null;
  size_bytes: string | number; mtime_ms: string | number; word_count: number;
  created_at: Date | string; updated_at: Date | string;
};

const NOVEL_COLUMNS = `n.id, n.title, n.description, n.file_name, n.relative_path, n.source_id,
  n.storage_mode, n.chapter_count, n.access_mode, n.soda_price, n.preview_chapter_count,
  n.content_hash, n.published_content_version, n.size_bytes, n.mtime_ms, n.word_count,
  n.visit_count, n.last_accessed_at, n.last_accessed_ip,
  n.last_accessed_user_agent, n.created_at, n.updated_at, n.recommend_count`;

function positiveId(value: unknown, label = "id"): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) throw new Error(`无效的${label}`);
  return parsed;
}

function nonnegative(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`PostgreSQL 返回了无效的${label}`);
  return parsed;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("PostgreSQL 返回了无效时间");
  return date.toISOString();
}

function toNovel(row: RawNovel): AdminNovel {
  return {
    ...row,
    source_id: row.source_id === null ? null : positiveId(row.source_id, "小说来源"),
    size_bytes: nonnegative(row.size_bytes, "小说大小"),
    mtime_ms: nonnegative(row.mtime_ms, "小说修改时间"),
    visit_count: nonnegative(row.visit_count, "访问量"),
    recommend_count: nonnegative(row.recommend_count, "推荐数"),
    last_accessed_at: iso(row.last_accessed_at),
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function toSource(row: RawSource): NovelSource {
  return {
    id: positiveId(row.id, "来源"), slug: row.slug, name: row.name, relativePath: row.relative_path,
    sortOrder: row.sort_order, novelCount: nonnegative(row.novel_count, "来源小说数"),
    singleNovelCount: nonnegative(row.single_novel_count, "单文件小说数"),
    chapterNovelCount: nonnegative(row.chapter_novel_count, "分章小说数"),
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

function toChapter(row: RawChapter): NovelChapter {
  return {
    id: positiveId(row.id, "章节"), novelId: positiveId(row.novel_id, "章节小说"), title: row.title,
    relativePath: row.relative_path, sortOrder: row.sort_order, contentHash: row.content_hash,
    publishedContentVersion: row.published_content_version,
    sizeBytes: nonnegative(row.size_bytes, "章节大小"), mtimeMs: nonnegative(row.mtime_ms, "章节修改时间"),
    wordCount: row.word_count, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
  };
}

function normalizeSort(value: string | undefined): AdminBookSortKey {
  return value === "title" || value === "file_name" || value === "size_bytes" || value === "word_count" ||
    value === "updated_at" || value === "visit_count" || value === "last_accessed_at" ? value : "updated_at";
}

const SORT_COLUMNS: Record<AdminBookSortKey, string> = {
  title: `lower(n.title) COLLATE "C"`, file_name: `lower(n.file_name) COLLATE "C"`, size_bytes: "n.size_bytes",
  word_count: "n.word_count", updated_at: "n.updated_at", visit_count: "n.visit_count",
  last_accessed_at: "n.last_accessed_at",
};

function queryTerms(value: string): string[] {
  return [...new Set(value.normalize("NFKC").trim().split(/\s+/u).filter(Boolean))].slice(0, 8);
}

export async function listPostgresAdminBooks(
  executor: SqlExecutor,
  params: { page?: number; q?: string; pageSize?: number; sort?: string; dir?: string; sourceId?: number },
): Promise<AdminBookListResult> {
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 20), 1), 200);
  const query = String(params.q || "").normalize("NFKC").trim().slice(0, 200);
  const terms = queryTerms(query);
  const sort = normalizeSort(params.sort);
  const dir: AdminBookSortDir = params.dir === "asc" ? "asc" : "desc";
  const sourceId = Number.isSafeInteger(params.sourceId) && Number(params.sourceId) > 0 ? Number(params.sourceId) : null;
  const values: unknown[] = [];
  const filters: string[] = [];
  const parameter = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (sourceId) filters.push(`n.source_id = ${parameter(sourceId)}`);
  for (const term of terms) {
    const forms = await normalizeChineseSearchForms(term, "title");
    if (!forms.original) continue;
    const escaped = forms.original.replace(/[%_\\]/gu, "\\$&");
    const original = parameter(escaped);
    if (forms.hans) {
      const hans = parameter(forms.hans.replace(/[%_\\]/gu, "\\$&"));
      filters.push(`(n.title_search_original LIKE '%' || ${original} || '%' ESCAPE E'\\\\' OR n.title_search_hans LIKE '%' || ${hans} || '%' ESCAPE E'\\\\')`);
    } else {
      filters.push(`(n.title_search_original LIKE '%' || ${original} || '%' ESCAPE E'\\\\' OR n.title_search_hans LIKE '%' || ${original} || '%' ESCAPE E'\\\\')`);
    }
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const countResult = await executor.query<{ total: string | number }>({
    text: `SELECT COUNT(*)::bigint AS total FROM novels n ${where}`,
    values,
  });
  const totalBooks = nonnegative(countResult.rows[0]?.total ?? 0, "小说总数");
  const totalPages = Math.max(1, Math.ceil(totalBooks / pageSize));
  const requestedPage = Number.isFinite(params.page) ? Math.floor(Number(params.page)) : 1;
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const rows = await executor.query<RawNovel>({
    text: `SELECT ${NOVEL_COLUMNS} FROM novels n ${where}
      ORDER BY ${SORT_COLUMNS[sort]} ${dir.toUpperCase()} NULLS LAST, n.id ${dir.toUpperCase()}
      LIMIT ${parameter(pageSize)} OFFSET ${parameter((page - 1) * pageSize)}`,
    values,
  });
  return { books: rows.rows.map(toNovel), page, pageSize, totalBooks, totalPages, query, sort, dir };
}

export async function getPostgresAdminNovel(executor: SqlExecutor, idValue: number): Promise<AdminNovel | null> {
  const id = positiveId(idValue, "小说");
  const result = await executor.query<RawNovel>({ text: `SELECT ${NOVEL_COLUMNS} FROM novels n WHERE n.id = $1`, values: [id] });
  return result.rows[0] ? toNovel(result.rows[0]) : null;
}

export async function listPostgresAdminNovelsByIds(executor: SqlExecutor, idValues: readonly number[]): Promise<AdminNovel[]> {
  const ids = [...new Set(idValues.map((id) => positiveId(id, "小说")))].slice(0, 500);
  if (!ids.length) return [];
  const result = await executor.query<RawNovel>({
    text: `SELECT ${NOVEL_COLUMNS}, requested.ordinal FROM unnest($1::integer[]) WITH ORDINALITY requested(id, ordinal)
      JOIN novels n ON n.id = requested.id ORDER BY requested.ordinal`, values: [ids],
  });
  return result.rows.map(toNovel);
}

const SOURCE_SELECT = `SELECT s.id, s.slug, s.name, s.relative_path, s.sort_order,
  COUNT(n.id)::bigint AS novel_count,
  COUNT(n.id) FILTER (WHERE n.storage_mode = 'single')::bigint AS single_novel_count,
  COUNT(n.id) FILTER (WHERE n.storage_mode = 'chapters')::bigint AS chapter_novel_count,
  s.created_at, s.updated_at FROM novel_sources s LEFT JOIN novels n ON n.source_id = s.id`;

export async function listPostgresAdminNovelSources(executor: SqlExecutor, includeEmpty = false): Promise<NovelSource[]> {
  const result = await executor.query<RawSource>({ text: `${SOURCE_SELECT} GROUP BY s.id
    ${includeEmpty ? "" : "HAVING COUNT(n.id) > 0"}
    ORDER BY CASE WHEN lower(s.slug) = 'default' THEN 0 ELSE 1 END, s.sort_order, lower(s.name) COLLATE "C", s.id` });
  return result.rows.map(toSource);
}

export async function getPostgresAdminNovelSource(executor: SqlExecutor, idValue: number): Promise<NovelSource | null> {
  const result = await executor.query<RawSource>({ text: `${SOURCE_SELECT} WHERE s.id = $1 GROUP BY s.id`, values: [positiveId(idValue, "来源")] });
  return result.rows[0] ? toSource(result.rows[0]) : null;
}

export function getNovelSourceStoragePath(source: Pick<NovelSource, "slug" | "relativePath">): string {
  return source.slug.toLocaleLowerCase("en-US") === "default"
    ? "default"
    : source.relativePath.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}

export async function listPostgresAdminNovelChapters(
  executor: SqlExecutor, novelIdValue: number, requestedPage = 1, requestedPageSize = 100,
): Promise<NovelChapterPage> {
  const novelId = positiveId(novelIdValue, "小说");
  const pageSize = Math.min(Math.max(Math.floor(requestedPageSize || 100), 20), 200);
  const count = await executor.query<{ total: string | number }>({ text: "SELECT COUNT(*)::bigint AS total FROM novel_chapters WHERE novel_id = $1", values: [novelId] });
  const totalChapters = nonnegative(count.rows[0]?.total ?? 0, "章节总数");
  const totalPages = Math.max(1, Math.ceil(totalChapters / pageSize));
  const page = Math.min(Math.max(Math.floor(requestedPage || 1), 1), totalPages);
  const rows = await executor.query<RawChapter>({
    text: `SELECT c.id, c.novel_id, COALESCE(NULLIF(c.title_override, ''), c.title) AS title,
      c.relative_path, COALESCE(c.sort_override, c.sort_order) AS sort_order, c.content_hash,
      c.published_content_version, c.size_bytes, c.mtime_ms, c.word_count, c.created_at, c.updated_at
      FROM novel_chapters c WHERE c.novel_id = $1
      ORDER BY COALESCE(c.sort_override, c.sort_order), c.id LIMIT $2 OFFSET $3`,
    values: [novelId, pageSize, (page - 1) * pageSize],
  });
  return { chapters: rows.rows.map(toChapter), page, pageSize, totalChapters, totalPages };
}

export async function listPostgresPinnedNovels(executor: SqlExecutor): Promise<PinnedNovel[]> {
  const result = await executor.query<QueryResultRow & { id: number; title: string; sort_order: number; created_at: Date | string }>({
    text: `SELECT n.id, n.title, p.sort_order, p.created_at FROM pinned_novels p
      JOIN novels n ON n.id = p.novel_id ORDER BY p.sort_order, p.novel_id`,
  });
  return result.rows.map((row) => ({ id: positiveId(row.id), title: row.title, sortOrder: row.sort_order, createdAt: iso(row.created_at)! }));
}

export async function togglePostgresPinnedNovel(novelIdValue: number): Promise<boolean> {
  const novelId = positiveId(novelIdValue, "小说");
  return withTransaction(async (tx) => {
    const exists = await tx.query({ text: "SELECT id FROM novels WHERE id = $1 FOR UPDATE", values: [novelId] });
    if (!exists.rows[0]) throw new Error("小说不存在");
    const removed = await tx.query({ text: "DELETE FROM pinned_novels WHERE novel_id = $1", values: [novelId] });
    if (removed.rowCount) return false;
    await tx.query({ text: `INSERT INTO pinned_novels (novel_id, sort_order)
      SELECT $1, COALESCE(MAX(sort_order), 0) + 10 FROM pinned_novels`, values: [novelId] });
    return true;
  }, { isolation: "serializable" });
}

export async function replacePostgresPinnedNovels(idValues: readonly number[]): Promise<number> {
  const ids = [...new Set(idValues.map((id) => positiveId(id, "小说")))].slice(0, 500);
  return withTransaction(async (tx) => {
    const found = ids.length ? await tx.query<{ id: number }>({ text: "SELECT id FROM novels WHERE id = ANY($1::integer[]) FOR SHARE", values: [ids] }) : null;
    if ((found?.rowCount ?? 0) !== ids.length) throw new Error("置顶列表中包含不存在的小说");
    await tx.query({ text: ids.length ? "DELETE FROM pinned_novels WHERE NOT (novel_id = ANY($1::integer[]))" : "DELETE FROM pinned_novels", values: ids.length ? [ids] : [] });
    if (ids.length) await tx.query({
      text: `INSERT INTO pinned_novels (novel_id, sort_order, updated_at)
        SELECT id, ordinal::integer * 10, clock_timestamp() FROM unnest($1::integer[]) WITH ORDINALITY requested(id, ordinal)
        ON CONFLICT (novel_id) DO UPDATE SET sort_order = excluded.sort_order, updated_at = excluded.updated_at`, values: [ids],
    });
    return ids.length;
  }, { isolation: "serializable" });
}

export async function isPostgresNovelInRecommendationPool(executor: SqlExecutor, novelIdValue: number): Promise<boolean> {
  const result = await executor.query({ text: "SELECT 1 FROM novel_recommendation_pool WHERE novel_id = $1", values: [positiveId(novelIdValue, "小说")] });
  return Boolean(result.rows[0]);
}

export async function setPostgresNovelRecommendationPool(novelIdValue: number, included: boolean): Promise<void> {
  const novelId = positiveId(novelIdValue, "小说");
  await withTransaction(async (tx) => {
    const novel = await tx.query({ text: "SELECT id FROM novels WHERE id = $1 FOR UPDATE", values: [novelId] });
    if (!novel.rows[0]) throw new Error("小说不存在");
    if (!included) {
      await tx.query({ text: "DELETE FROM novel_recommendation_pool WHERE novel_id = $1", values: [novelId] });
      return;
    }
    const count = await tx.query<{ total: string | number }>({ text: "SELECT COUNT(*)::bigint AS total FROM novel_recommendation_pool" });
    if (nonnegative(count.rows[0]?.total ?? 0, "推荐池数量") >= 10_000) throw new Error("推荐池最多收录 10000 本小说");
    await tx.query({ text: "INSERT INTO novel_recommendation_pool (novel_id) VALUES ($1) ON CONFLICT DO NOTHING", values: [novelId] });
  }, { isolation: "serializable" });
}

export async function updatePostgresNovelMetadata(input: {
  novelId: number; title: string; description: string; accessMode: NovelAccessMode;
  sodaPrice: number; previewChapterCount: number;
}): Promise<void> {
  const novelId = positiveId(input.novelId, "小说");
  const title = input.title.normalize("NFKC").trim();
  if (!title || Array.from(title).length > 120 || title.includes("\0")) throw new Error("小说名称应为 1 到 120 个字符");
  const description = input.description.replace(/\r\n?/gu, "\n").trim();
  if (description.length > 2_000 || description.includes("\0")) throw new Error("书籍简介不能超过 2000 个字符");
  const accessMode: NovelAccessMode = input.accessMode === "soda" ? "soda" : "inherit";
  const sodaPrice = accessMode === "soda" ? Math.min(Math.max(Math.floor(input.sodaPrice), 1), 1_000_000) : 0;
  const forms = await normalizeChineseSearchForms(title, "title");
  const result = await database().query({
    text: `UPDATE novels SET title = $2, title_search_original = $3, title_search_hans = $4,
      normalization_version = $5, description = $6, access_mode = $7, soda_price = $8,
      preview_chapter_count = CASE WHEN storage_mode = 'chapters' THEN LEAST($9, chapter_count) ELSE 0 END,
      updated_at = clock_timestamp() WHERE id = $1`,
    values: [novelId, title, forms.original, forms.hans, forms.version, description, accessMode, sodaPrice,
      Math.min(Math.max(Math.floor(input.previewChapterCount), 0), 100_000)],
  });
  if (!result.rowCount) throw new Error("小说不存在");
}

export async function updatePostgresNovelTitles(inputs: readonly { novelId: number; title: string }[]): Promise<number> {
  const unique = [...new Map(inputs.map((input) => [positiveId(input.novelId, "小说"), input])).values()].slice(0, 500);
  const normalized = await Promise.all(unique.map(async (input) => {
    const title = input.title.normalize("NFKC").trim();
    if (!title || Array.from(title).length > 120 || title.includes("\0")) throw new Error("小说名称应为 1 到 120 个字符");
    const forms = await normalizeChineseSearchForms(title, "title");
    return { id: input.novelId, title, original: forms.original, hans: forms.hans, version: forms.version };
  }));
  if (!normalized.length) return 0;
  const result = await database().query({
    text: `UPDATE novels n SET title=input.title, title_search_original=input.original,
      title_search_hans=input.hans, normalization_version=input.version, updated_at=clock_timestamp()
      FROM jsonb_to_recordset($1::jsonb) input(id integer,title text,original text,hans text,version integer)
      WHERE n.id=input.id`, values: [JSON.stringify(normalized)],
  });
  if (result.rowCount !== normalized.length) throw new Error("部分小说已不存在，请刷新后重试");
  return result.rowCount ?? 0;
}

export async function updatePostgresNovelChapterOverrides(novelIdValue: number, updates: readonly NovelChapterUpdate[]): Promise<number> {
  const novelId = positiveId(novelIdValue, "小说");
  const normalized = [...new Map(updates.map((update) => {
    const id = positiveId(update.id, "章节");
    const title = update.title.normalize("NFKC").trim();
    if (!title || Array.from(title).length > 160 || title.includes("\0")) throw new Error("章节标题应为 1 到 160 个字符");
    return [id, { id, title, sortOrder: Math.min(Math.max(Math.floor(update.sortOrder), 0), 2_147_483_647) }] as const;
  })).values()];
  if (!normalized.length) return 0;
  return withTransaction(async (tx) => {
    const rows = await tx.query<{ id: number }>({ text: "SELECT id FROM novel_chapters WHERE novel_id = $1 FOR UPDATE", values: [novelId] });
    const existing = new Set(rows.rows.map((row) => row.id));
    if (!rows.rowCount) throw new Error("章节小说不存在或尚无章节");
    if (normalized.some((item) => !existing.has(item.id))) throw new Error("章节列表已变化，请刷新后重试");
    const saved = await tx.query({
      text: `UPDATE novel_chapters c SET title_override = input.title, sort_override = input.sort_order,
        updated_at = clock_timestamp() FROM jsonb_to_recordset($2::jsonb) input(id integer, title text, sort_order integer)
        WHERE c.novel_id = $1 AND c.id = input.id`, values: [novelId, JSON.stringify(normalized)],
    });
    await tx.query({ text: "UPDATE novels SET updated_at = clock_timestamp() WHERE id = $1", values: [novelId] });
    return saved.rowCount ?? 0;
  }, { isolation: "serializable" });
}

export function chapterAggregateHash(chapters: readonly { relativePath: string; contentHash: string }[]): string {
  const hash = createHash("sha256");
  for (const chapter of chapters) hash.update(chapter.relativePath).update("\0").update(chapter.contentHash).update("\0");
  return hash.digest("hex");
}
