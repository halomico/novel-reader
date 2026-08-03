import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getLibraryDir } from "./config";
import { getDb } from "./db";
import { createNovelSegments, type NovelSegment } from "./segments";
import { decodeNovelBuffer } from "./text";
import { ALL_NOVEL_LIBRARIES_SLUG, DEFAULT_NOVEL_LIBRARY_SLUG } from "./novel-library-scope";

export { ALL_NOVEL_LIBRARIES_SLUG, DEFAULT_NOVEL_LIBRARY_SLUG, novelLibraryDisplayName } from "./novel-library-scope";

export type NovelStorageMode = "single" | "chapters";
export type NovelAccessMode = "inherit" | "soda";

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

export type NovelLibraryScope =
  | { kind: "source"; slug: string; source: NovelSource }
  | { kind: "all"; slug: "all"; source: null };

export type NovelChapter = {
  id: number;
  novelId: number;
  title: string;
  relativePath: string;
  sortOrder: number;
  contentHash: string | null;
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

export type NovelChapterUpdate = {
  id: number;
  title: string;
  sortOrder: number;
};

type SourceRow = {
  id: number;
  slug: string;
  name: string;
  relative_path: string;
  sort_order: number;
  novel_count: number;
  single_novel_count: number;
  chapter_novel_count: number;
  created_at: string;
  updated_at: string;
};

type ChapterRow = {
  id: number;
  novel_id: number;
  title: string;
  relative_path: string;
  sort_order: number;
  content_hash: string | null;
  size_bytes: number;
  mtime_ms: number;
  word_count: number;
  created_at: string;
  updated_at: string;
};

type ChapterCacheEntry = {
  key: string;
  bytes: number;
  content: string;
  segments: NovelSegment[];
};

type NovelLibraryGlobal = typeof globalThis & {
  novelChapterCache?: Map<number, ChapterCacheEntry>;
  novelChapterCacheBytes?: number;
  novelChapterLoads?: Map<string, Promise<ChapterCacheEntry>>;
};

const CHAPTER_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const CHAPTER_CACHE_MAX_ENTRIES = 96;
const CHAPTER_SORT_EXPRESSION = "COALESCE(sort_override, sort_order)";
export const DEFAULT_NOVEL_SOURCE_DIRECTORY = "default";
const CHAPTER_SELECT_COLUMNS = `id, novel_id,
  COALESCE(NULLIF(title_override, ''), title) AS title,
  relative_path, ${CHAPTER_SORT_EXPRESSION} AS sort_order, content_hash,
  size_bytes, mtime_ms, word_count, created_at, updated_at`;

function toSource(row: SourceRow): NovelSource {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    relativePath: row.relative_path,
    sortOrder: row.sort_order,
    novelCount: row.novel_count,
    singleNovelCount: row.single_novel_count,
    chapterNovelCount: row.chapter_novel_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChapter(row: ChapterRow): NovelChapter {
  return {
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    relativePath: row.relative_path,
    sortOrder: row.sort_order,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    wordCount: row.word_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceSelect(): string {
  return `
    SELECT s.id, s.slug, s.name, s.relative_path, s.sort_order,
           COUNT(n.id) AS novel_count,
           COALESCE(SUM(CASE WHEN n.storage_mode = 'single' THEN 1 ELSE 0 END), 0) AS single_novel_count,
           COALESCE(SUM(CASE WHEN n.storage_mode = 'chapters' THEN 1 ELSE 0 END), 0) AS chapter_novel_count,
           s.created_at, s.updated_at
    FROM novel_sources s
    LEFT JOIN novels n ON n.source_id = s.id`;
}

export function getNovelSourceStoragePath(
  source: Pick<NovelSource, "slug" | "relativePath">,
): string {
  if (source.slug.toLocaleLowerCase("en-US") === "default") {
    return DEFAULT_NOVEL_SOURCE_DIRECTORY;
  }
  return source.relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function listNovelSources(options: { includeEmpty?: boolean } = {}): NovelSource[] {
  const rows = getDb().prepare(
    `${sourceSelect()}
     GROUP BY s.id
     ${options.includeEmpty ? "" : "HAVING COUNT(n.id) > 0"}
     ORDER BY CASE WHEN s.slug = 'default' COLLATE NOCASE THEN 0 ELSE 1 END,
              s.sort_order ASC, s.name COLLATE NOCASE ASC, s.id ASC`,
  ).all() as SourceRow[];
  return rows.map(toSource);
}

export function getNovelSourceBySlug(slug: string): NovelSource | null {
  const row = getDb().prepare(
    `${sourceSelect()}
     WHERE s.slug = ? COLLATE NOCASE
     GROUP BY s.id`,
  ).get(slug) as SourceRow | undefined;
  return row ? toSource(row) : null;
}

export function getNovelSourceById(id: number): NovelSource | null {
  const row = getDb().prepare(
    `${sourceSelect()}
     WHERE s.id = ?
     GROUP BY s.id`,
  ).get(id) as SourceRow | undefined;
  return row ? toSource(row) : null;
}

export function resolveNovelLibraryScope(value?: string | null): NovelLibraryScope {
  const requested = String(value || "").normalize("NFKC").trim().slice(0, 64).toLocaleLowerCase("en-US");
  if (requested === ALL_NOVEL_LIBRARIES_SLUG) {
    return { kind: "all", slug: ALL_NOVEL_LIBRARIES_SLUG, source: null };
  }
  const defaultSource = getNovelSourceBySlug(DEFAULT_NOVEL_LIBRARY_SLUG);
  if (!defaultSource) throw new Error("默认书库不存在");
  const source = requested && requested !== DEFAULT_NOVEL_LIBRARY_SLUG
    ? getNovelSourceBySlug(requested) || defaultSource
    : defaultSource;
  return { kind: "source", slug: source.slug, source };
}

export function listNovelIdsBySource(sourceId: number): number[] {
  if (!Number.isInteger(sourceId) || sourceId < 1) return [];
  return (getDb().prepare("SELECT id FROM novels WHERE source_id = ? ORDER BY id ASC").all(sourceId) as Array<{ id: number }>)
    .map((row) => row.id);
}

export function stableNovelSourceSlug(relativePath: string): string {
  if (!relativePath) return "default";
  const readable = relativePath
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);
  const suffix = crypto.createHash("sha256").update(relativePath).digest("hex").slice(0, 8);
  return `${readable || "source"}-${suffix}`;
}

export function upsertNovelSource(relativePath: string, name: string): number {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  const normalizedName = name.normalize("NFKC").trim().slice(0, 120) || "默认来源";
  const row = getDb().prepare(
    `INSERT INTO novel_sources (slug, name, relative_path, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(relative_path) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
     RETURNING id`,
  ).get(stableNovelSourceSlug(normalizedPath), normalizedName, normalizedPath) as { id: number };
  return row.id;
}

export function listNovelChapters(novelId: number): NovelChapter[] {
  const rows = getDb().prepare(
    `SELECT ${CHAPTER_SELECT_COLUMNS}
     FROM novel_chapters
     WHERE novel_id = ?
     ORDER BY ${CHAPTER_SORT_EXPRESSION} ASC, id ASC`,
  ).all(novelId) as ChapterRow[];
  return rows.map(toChapter);
}

export function listNovelChaptersPage(
  novelId: number,
  requestedPage = 1,
  requestedPageSize = 100,
): NovelChapterPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(requestedPageSize || 100), 20), 200);
  const total = db.prepare("SELECT COUNT(*) AS count FROM novel_chapters WHERE novel_id = ?")
    .get(novelId) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = Math.min(Math.max(Math.floor(requestedPage || 1), 1), totalPages);
  const rows = db.prepare(
    `SELECT ${CHAPTER_SELECT_COLUMNS}
     FROM novel_chapters
     WHERE novel_id = ?
     ORDER BY ${CHAPTER_SORT_EXPRESSION} ASC, id ASC
     LIMIT ? OFFSET ?`,
  ).all(novelId, pageSize, (page - 1) * pageSize) as ChapterRow[];
  return {
    chapters: rows.map(toChapter),
    page,
    pageSize,
    totalChapters: total.count,
    totalPages,
  };
}

export function getNovelChapter(novelId: number, chapterId: number): NovelChapter | null {
  const row = getDb().prepare(
    `SELECT ${CHAPTER_SELECT_COLUMNS}
     FROM novel_chapters
     WHERE novel_id = ? AND id = ?`,
  ).get(novelId, chapterId) as ChapterRow | undefined;
  return row ? toChapter(row) : null;
}

export function getFirstNovelChapter(novelId: number): NovelChapter | null {
  const row = getDb().prepare(
    `SELECT ${CHAPTER_SELECT_COLUMNS}
     FROM novel_chapters
     WHERE novel_id = ?
     ORDER BY ${CHAPTER_SORT_EXPRESSION} ASC, id ASC
     LIMIT 1`,
  ).get(novelId) as ChapterRow | undefined;
  return row ? toChapter(row) : null;
}

export function getAdjacentNovelChapters(
  novelId: number,
  sortOrder: number,
): { previous: NovelChapter | null; next: NovelChapter | null } {
  const db = getDb();
  const previous = db.prepare(
    `SELECT ${CHAPTER_SELECT_COLUMNS}
     FROM novel_chapters
     WHERE novel_id = ? AND ${CHAPTER_SORT_EXPRESSION} < ?
     ORDER BY ${CHAPTER_SORT_EXPRESSION} DESC, id DESC
     LIMIT 1`,
  ).get(novelId, sortOrder) as ChapterRow | undefined;
  const next = db.prepare(
    `SELECT ${CHAPTER_SELECT_COLUMNS}
     FROM novel_chapters
     WHERE novel_id = ? AND ${CHAPTER_SORT_EXPRESSION} > ?
     ORDER BY ${CHAPTER_SORT_EXPRESSION} ASC, id ASC
     LIMIT 1`,
  ).get(novelId, sortOrder) as ChapterRow | undefined;
  return { previous: previous ? toChapter(previous) : null, next: next ? toChapter(next) : null };
}

export function getNovelChapterPosition(novelId: number, chapter: Pick<NovelChapter, "id" | "sortOrder">): {
  index: number;
  total: number;
} {
  const row = getDb().prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE
         WHEN ${CHAPTER_SORT_EXPRESSION} < ?
           OR (${CHAPTER_SORT_EXPRESSION} = ? AND id < ?)
         THEN 1 ELSE 0 END) AS chapter_index
     FROM novel_chapters
     WHERE novel_id = ?`,
  ).get(chapter.sortOrder, chapter.sortOrder, chapter.id, novelId) as {
    total: number;
    chapter_index: number | null;
  };
  return { index: Math.max(row.chapter_index || 0, 0), total: Math.max(row.total || 0, 0) };
}

export function updateNovelChapterOverrides(novelId: number, updates: NovelChapterUpdate[]): number {
  if (!Number.isInteger(novelId) || novelId < 1) throw new Error("小说不存在");
  const normalized = new Map<number, { title: string; sortOrder: number }>();
  for (const update of updates) {
    if (!Number.isInteger(update.id) || update.id < 1) continue;
    const title = update.title.normalize("NFKC").trim();
    if (!title || title.length > 160) throw new Error("章节标题应为 1 到 160 个字符");
    normalized.set(update.id, {
      title,
      sortOrder: Math.max(0, Math.floor(update.sortOrder)),
    });
  }
  if (!normalized.size) return 0;

  const db = getDb();
  const rows = db.prepare(
    `SELECT id, title, title_override, relative_path, sort_order, sort_override, content_hash
     FROM novel_chapters
     WHERE novel_id = ?
     ORDER BY ${CHAPTER_SORT_EXPRESSION} ASC, id ASC`,
  ).all(novelId) as Array<{
    id: number;
    title: string;
    title_override: string | null;
    relative_path: string;
    sort_order: number;
    sort_override: number | null;
    content_hash: string | null;
  }>;
  if (!rows.length) throw new Error("章节小说不存在或尚无章节");
  const rowIds = new Set(rows.map((row) => row.id));
  if ([...normalized.keys()].some((id) => !rowIds.has(id))) throw new Error("章节列表已变化，请刷新后重试");

  const ordered = rows.map((row, index) => ({
    ...row,
    currentOrder: row.sort_override ?? row.sort_order ?? index,
    desiredOrder: normalized.get(row.id)?.sortOrder ?? (row.sort_override ?? row.sort_order ?? index),
  })).sort((left, right) => (
    left.desiredOrder - right.desiredOrder || left.currentOrder - right.currentOrder || left.id - right.id
  ));

  db.exec("BEGIN IMMEDIATE");
  try {
    const save = db.prepare(
      `UPDATE novel_chapters
       SET title_override = ?, sort_override = ?, updated_at = CURRENT_TIMESTAMP
       WHERE novel_id = ? AND id = ?`,
    );
    ordered.forEach((row, index) => {
      const requested = normalized.get(row.id);
      const effectiveTitle = requested?.title || row.title_override || row.title;
      save.run(effectiveTitle === row.title ? null : effectiveTitle, index, novelId, row.id);
    });
    const contentHash = crypto.createHash("sha256");
    for (const row of ordered) {
      contentHash.update(row.relative_path).update("\0").update(row.content_hash || "").update("\0");
    }
    db.prepare(
      "UPDATE novels SET content_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND storage_mode = 'chapters'",
    ).run(contentHash.digest("hex"), novelId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return normalized.size;
}

function resolveChapterPath(relativePath: string): string {
  const root = path.resolve(getLibraryDir());
  const filePath = path.resolve(root, relativePath);
  if (filePath === root || !filePath.startsWith(`${root}${path.sep}`)) {
    throw new Error("章节文件路径不在小说目录内");
  }
  return filePath;
}

function chapterCacheKey(chapter: NovelChapter): string {
  return `${chapter.relativePath}:${novelChapterContentVersion(chapter)}`;
}

export function novelChapterContentVersion(
  chapter: Pick<NovelChapter, "contentHash" | "sizeBytes" | "mtimeMs">,
): string {
  return chapter.contentHash || `${chapter.sizeBytes}:${Math.floor(chapter.mtimeMs)}`;
}

async function loadChapter(chapter: NovelChapter): Promise<ChapterCacheEntry> {
  const state = globalThis as NovelLibraryGlobal;
  state.novelChapterCache ||= new Map();
  state.novelChapterCacheBytes ||= 0;
  state.novelChapterLoads ||= new Map();
  const cache = state.novelChapterCache;
  const loads = state.novelChapterLoads;
  const key = chapterCacheKey(chapter);
  const cached = cache.get(chapter.id);
  if (cached?.key === key) {
    cache.delete(chapter.id);
    cache.set(chapter.id, cached);
    return cached;
  }
  const pending = loads.get(key);
  if (pending) return pending;
  const loading = (async () => {
    const buffer = await fs.readFile(resolveChapterPath(chapter.relativePath));
    const content = decodeNovelBuffer(buffer);
    const entry = {
      key,
      bytes: Math.max(buffer.length, content.length * 2),
      content,
      segments: createNovelSegments(content),
    };
    if (entry.bytes <= CHAPTER_CACHE_MAX_BYTES / 2) {
      if (cached) state.novelChapterCacheBytes = Math.max(0, state.novelChapterCacheBytes! - cached.bytes);
      while (
        cache.size >= CHAPTER_CACHE_MAX_ENTRIES ||
        state.novelChapterCacheBytes! + entry.bytes > CHAPTER_CACHE_MAX_BYTES
      ) {
        const oldest = cache.entries().next().value as [number, ChapterCacheEntry] | undefined;
        if (!oldest) break;
        cache.delete(oldest[0]);
        state.novelChapterCacheBytes = Math.max(0, state.novelChapterCacheBytes! - oldest[1].bytes);
      }
      cache.set(chapter.id, entry);
      state.novelChapterCacheBytes! += entry.bytes;
    }
    return entry;
  })();
  loads.set(key, loading);
  try {
    return await loading;
  } finally {
    if (loads.get(key) === loading) loads.delete(key);
  }
}

export async function readNovelChapterContent(chapter: NovelChapter): Promise<string> {
  return (await loadChapter(chapter)).content;
}

export async function readNovelChapterSegments(chapter: NovelChapter): Promise<NovelSegment[]> {
  return (await loadChapter(chapter)).segments;
}

export function clearNovelChapterCache() {
  const state = globalThis as NovelLibraryGlobal;
  state.novelChapterCache?.clear();
  state.novelChapterLoads?.clear();
  state.novelChapterCacheBytes = 0;
}

export function updateNovelDescription(novelId: number, value: string) {
  if (!Number.isInteger(novelId) || novelId < 1) throw new Error("小说不存在");
  const description = value.replace(/\r\n?/g, "\n").trim();
  if (description.length > 2_000) throw new Error("书籍简介不能超过 2000 个字符");
  const result = getDb().prepare(
    "UPDATE novels SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(description, novelId);
  if (!result.changes) throw new Error("小说不存在");
  return description;
}

export function updateNovelAccessPolicy(
  novelId: number,
  input: { accessMode: NovelAccessMode; sodaPrice: number; previewChapterCount: number },
) {
  const accessMode: NovelAccessMode = input.accessMode === "soda" ? "soda" : "inherit";
  const sodaPrice = accessMode === "soda" ? Math.min(Math.max(Math.floor(input.sodaPrice), 1), 1_000_000) : 0;
  const row = getDb().prepare("SELECT storage_mode, chapter_count FROM novels WHERE id = ?")
    .get(novelId) as { storage_mode: NovelStorageMode; chapter_count: number } | undefined;
  if (!row) throw new Error("小说不存在");
  const previewChapterCount = row.storage_mode === "chapters" && accessMode === "soda"
    ? Math.min(Math.max(Math.floor(input.previewChapterCount), 0), Math.max(row.chapter_count, 0))
    : 0;
  getDb().prepare(
    `UPDATE novels
     SET access_mode = ?, soda_price = ?, preview_chapter_count = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(accessMode, sodaPrice, previewChapterCount, novelId);
}
