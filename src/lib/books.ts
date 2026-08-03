import fs from "node:fs/promises";
import path from "node:path";
import { getCatalogFeatureSettings, getLibraryDir } from "./config";
import { getDb } from "./db";
import { sampleNovelIds, sampleNovelIdsFromList } from "./novel-id-sampler";
import { sampleRecommendationPoolNovelIds } from "./recommendation-pool";
import { createNovelSegments, NovelSegment } from "./segments";
import { parseSearchQuery, type ParsedSearchQuery, type SearchExpression } from "./search-query";
import { decodeNovelBuffer } from "./text";
import {
  listNovelChapters,
  readNovelChapterContent,
  type NovelAccessMode,
  type NovelStorageMode,
} from "./novel-library";

export type Novel = {
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
  size_bytes: number;
  mtime_ms: number;
  word_count: number;
  visit_count: number;
  last_accessed_at: string | null;
  last_accessed_ip: string | null;
  last_accessed_user_agent: string | null;
  created_at: string;
  updated_at: string;
};

export type NovelListResult = {
  books: Novel[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalPages: number;
  query: string;
  message?: string;
};

const DEFAULT_PAGE_SIZE = 15;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 100;
export const NOVEL_SELECT_COLUMNS = `id, title, description, file_name, relative_path, source_id, storage_mode,
  chapter_count, access_mode, soda_price, preview_chapter_count, content_hash, size_bytes,
  mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip,
  last_accessed_user_agent, created_at, updated_at`;
const NOVEL_SEGMENT_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const NOVEL_SEGMENT_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const NOVEL_SEGMENT_CACHE_MAX_ENTRIES = 32;

type NovelSegmentCacheEntry = {
  estimatedBytes: number;
  segments: NovelSegment[];
};

type NovelSegmentCacheGlobal = typeof globalThis & {
  novelSegmentCache?: Map<string, NovelSegmentCacheEntry>;
  novelSegmentCacheBytes?: number;
  novelSegmentLoads?: Map<string, Promise<NovelSegment[]>>;
};

function novelSegmentCacheKey(book: Novel): string {
  return [book.relative_path, book.content_hash || "", book.size_bytes, Math.floor(book.mtime_ms)].join(":");
}

function getNovelSegmentCache(): Map<string, NovelSegmentCacheEntry> {
  const state = globalThis as NovelSegmentCacheGlobal;
  state.novelSegmentCache ||= new Map();
  state.novelSegmentCacheBytes ||= 0;
  return state.novelSegmentCache;
}

function cacheNovelSegments(book: Novel, segments: NovelSegment[], estimatedBytes: number) {
  if (estimatedBytes > NOVEL_SEGMENT_CACHE_MAX_ENTRY_BYTES) {
    return;
  }

  const state = globalThis as NovelSegmentCacheGlobal;
  const cache = getNovelSegmentCache();
  const pathPrefix = `${book.relative_path}:`;
  for (const [key, entry] of cache) {
    if (key.startsWith(pathPrefix)) {
      cache.delete(key);
      state.novelSegmentCacheBytes = Math.max(0, (state.novelSegmentCacheBytes || 0) - entry.estimatedBytes);
    }
  }

  while (
    cache.size >= NOVEL_SEGMENT_CACHE_MAX_ENTRIES ||
    (state.novelSegmentCacheBytes || 0) + estimatedBytes > NOVEL_SEGMENT_CACHE_MAX_BYTES
  ) {
    const oldest = cache.entries().next().value as [string, NovelSegmentCacheEntry] | undefined;
    if (!oldest) break;
    cache.delete(oldest[0]);
    state.novelSegmentCacheBytes = Math.max(0, (state.novelSegmentCacheBytes || 0) - oldest[1].estimatedBytes);
  }

  cache.set(novelSegmentCacheKey(book), { segments, estimatedBytes });
  state.novelSegmentCacheBytes = (state.novelSegmentCacheBytes || 0) + estimatedBytes;
}

export function clearNovelSegmentCache() {
  const state = globalThis as NovelSegmentCacheGlobal;
  state.novelSegmentCache?.clear();
  state.novelSegmentLoads?.clear();
  state.novelSegmentCacheBytes = 0;
}

export function normalizePageSize(value: number | string | undefined): number {
  const pageSize = Number(value || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(pageSize)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(Math.floor(pageSize), MIN_PAGE_SIZE), MAX_PAGE_SIZE);
}

function normalizePage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

function compileTitleSearchExpression(expression: SearchExpression): { sql: string; values: string[] } {
  if (expression.type === "term") {
    return { sql: "instr(lower(title), lower(?)) > 0", values: [expression.value] };
  }
  if (expression.type === "not") {
    const child = compileTitleSearchExpression(expression.child);
    return { sql: `NOT (${child.sql})`, values: child.values };
  }
  const left = compileTitleSearchExpression(expression.left);
  const right = compileTitleSearchExpression(expression.right);
  const operator = expression.type === "and" ? "AND" : "OR";
  return { sql: `(${left.sql}) ${operator} (${right.sql})`, values: [...left.values, ...right.values] };
}

export function buildTitleSearchSql(query: ParsedSearchQuery): { whereSql: string; values: string[] } {
  const expression = compileTitleSearchExpression(query.expression);
  const required = query.requiredTerms.map((term) => ({ sql: "instr(lower(title), lower(?)) > 0", value: term.value }));
  const clauses = [...required.map((item) => item.sql), `(${expression.sql})`];
  return { whereSql: clauses.join(" AND "), values: [...required.map((item) => item.value), ...expression.values] };
}

export function listNovelsByIds(novelIds: number[]): Novel[] {
  const ids = Array.from(new Set(novelIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) {
    return [];
  }
  const placeholders = ids.map(() => "?").join(", ");
  const rows = getDb()
    .prepare(
      `SELECT ${NOVEL_SELECT_COLUMNS}
       FROM novels
       WHERE id IN (${placeholders})`,
    )
    .all(...ids) as Novel[];
  const byId = new Map(rows.map((book) => [book.id, book]));
  return ids.flatMap((id) => {
    const book = byId.get(id);
    return book ? [book] : [];
  });
}

function listRandomNovels(pageSize: number, seed: string, sourceId?: number): Novel[] {
  const db = getDb();
  if (!sourceId) return listNovelsByIds(sampleNovelIds(db, pageSize, seed));
  const sourceIds = (db.prepare("SELECT id FROM novels WHERE source_id = ? ORDER BY id ASC").all(sourceId) as Array<{ id: number }>)
    .map((row) => row.id);
  return listNovelsByIds(sampleNovelIdsFromList(sourceIds, pageSize, seed));
}

export function planCatalogPage(promotedIds: readonly number[], pageSize: number, offset: number) {
  return {
    promotedIds: promotedIds.slice(offset, offset + pageSize),
    baseOffset: Math.max(0, offset - promotedIds.length),
  };
}

function listCatalogNovels(pageSize: number, offset: number): Novel[] {
  const db = getDb();
  const settings = getCatalogFeatureSettings();
  const manualIds = settings.manualPinnedEnabled
    ? (db.prepare("SELECT novel_id FROM pinned_novels ORDER BY sort_order ASC, novel_id ASC").all() as Array<{ novel_id: number }>)
        .map((row) => row.novel_id)
    : [];
  const pinnedIds = new Set(manualIds);
  const intervalMs = settings.randomRecommendationIntervalMinutes * 60_000;
  const randomIds = settings.randomRecommendationsEnabled
    ? sampleRecommendationPoolNovelIds(
        db,
        settings.randomRecommendationCount,
        `catalog-recommendations:${Math.floor(Date.now() / intervalMs)}`,
        pinnedIds,
      )
    : [];
  const promotedIds = settings.promotionOrder === "random-first"
    ? [...randomIds, ...manualIds]
    : [...manualIds, ...randomIds];
  const pagePlan = planCatalogPage(promotedIds, pageSize, offset);
  const promotedBooks = listNovelsByIds(pagePlan.promotedIds);
  const remaining = pageSize - promotedBooks.length;
  if (remaining <= 0) {
    return promotedBooks;
  }

  const excludedSql = promotedIds.length ? `WHERE id NOT IN (${promotedIds.map(() => "?").join(", ")})` : "";
  const baseBooks = db
    .prepare(
      `SELECT ${NOVEL_SELECT_COLUMNS}
       FROM novels
       ${excludedSql}
       ORDER BY title COLLATE NOCASE ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...promotedIds, remaining, pagePlan.baseOffset) as Novel[];
  return [...promotedBooks, ...baseBooks];
}

export function listNovels(params: { page?: number; q?: string; pageSize?: number; randomSeed?: string; sourceId?: number }): NovelListResult {
  const db = getDb();
  const pageSize = normalizePageSize(params.pageSize);
  const query = (params.q || "").trim();

  if (query) {
    const validation = parseSearchQuery(query, { mode: "title" });
    if (!validation.ok) {
      return {
        books: [],
        page: 1,
        pageSize,
        totalBooks: 0,
        totalPages: 1,
        query: validation.keyword,
        message: validation.message,
      };
    }

    const search = buildTitleSearchSql(validation.query);
    const sourceClause = params.sourceId ? " AND source_id = ?" : "";
    const sourceValues = params.sourceId ? [params.sourceId] : [];
    const totalBooks = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM novels
         WHERE ${search.whereSql}${sourceClause}`,
      )
      .get(...search.values, ...sourceValues) as { count: number };
    const totalPages = Math.ceil(totalBooks.count / pageSize);
    const page = normalizePage(params.page || 1, totalPages);
    const offset = (page - 1) * pageSize;
    const books = db
      .prepare(
        `SELECT ${NOVEL_SELECT_COLUMNS}
         FROM novels
         WHERE ${search.whereSql}${sourceClause}
         ORDER BY title COLLATE NOCASE ASC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...search.values, ...sourceValues, pageSize, offset) as Novel[];

    return {
      books,
      page,
      pageSize,
      totalBooks: totalBooks.count,
      totalPages: Math.max(totalPages, 1),
      query: validation.keyword,
    };
  }

  const sourceFilter = params.sourceId ? " WHERE source_id = ?" : "";
  const sourceValues = params.sourceId ? [params.sourceId] : [];
  const totalBooks = db
    .prepare(`SELECT COUNT(*) AS count FROM novels${sourceFilter}`)
    .get(...sourceValues) as { count: number };
  const randomSeed = (params.randomSeed || "").trim().slice(0, 64);
  if (randomSeed) {
    return {
      books: listRandomNovels(pageSize, randomSeed, params.sourceId),
      page: 1,
      pageSize,
      totalBooks: totalBooks.count,
      totalPages: 1,
      query,
    };
  }
  const totalPages = Math.ceil(totalBooks.count / pageSize);
  const page = normalizePage(params.page || 1, totalPages);
  const offset = (page - 1) * pageSize;

  const books = params.sourceId
    ? db.prepare(
        `SELECT ${NOVEL_SELECT_COLUMNS}
         FROM novels
         WHERE source_id = ?
         ORDER BY title COLLATE NOCASE ASC, id ASC
         LIMIT ? OFFSET ?`,
      ).all(params.sourceId, pageSize, offset) as Novel[]
    : listCatalogNovels(pageSize, offset);

  return {
    books,
    page,
    pageSize,
    totalBooks: totalBooks.count,
    totalPages: Math.max(totalPages, 1),
    query,
  };
}

export function listRecentlyUpdatedNovels(params: { page?: number; pageSize?: number } = {}): NovelListResult {
  const db = getDb();
  const pageSize = normalizePageSize(params.pageSize);
  const totalBooks = db.prepare("SELECT COUNT(*) AS count FROM novels").get() as { count: number };
  const cappedTotalBooks = Math.min(totalBooks.count, 1_000);
  const totalPages = Math.max(1, Math.ceil(cappedTotalBooks / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const offset = (page - 1) * pageSize;
  const limit = Math.max(0, Math.min(pageSize, cappedTotalBooks - offset));
  const books = db.prepare(
    `SELECT ${NOVEL_SELECT_COLUMNS}
     FROM novels
     ORDER BY mtime_ms DESC, id DESC
     LIMIT ? OFFSET ?`,
  ).all(limit, offset) as Novel[];
  return { books, page, pageSize, totalBooks: cappedTotalBooks, totalPages, query: "" };
}

export function getNovelById(id: number): Novel | null {
  const db = getDb();
  const book = db
    .prepare(
      `SELECT ${NOVEL_SELECT_COLUMNS}
       FROM novels
       WHERE id = ?`,
    )
    .get(id) as Novel | undefined;

  return book || null;
}

export async function readNovelContent(book: Pick<Novel, "relative_path"> & Partial<Pick<Novel, "id" | "storage_mode">>): Promise<string> {
  if (book.storage_mode === "chapters" && book.id) {
    const chapters = listNovelChapters(book.id);
    return (await Promise.all(chapters.map(readNovelChapterContent))).join("\n\n");
  }
  const libraryDir = getLibraryDir();
  const filePath = path.resolve(libraryDir, book.relative_path);
  const libraryRoot = path.resolve(libraryDir);

  if (filePath !== libraryRoot && !filePath.startsWith(`${libraryRoot}${path.sep}`)) {
    throw new Error("小说文件路径不在小说目录内");
  }

  const buffer = await fs.readFile(filePath);
  return decodeNovelBuffer(buffer);
}

export async function readNovelSegments(book: Novel): Promise<NovelSegment[]> {
  const cache = getNovelSegmentCache();
  const key = novelSegmentCacheKey(book);
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached.segments;
  }

  const state = globalThis as NovelSegmentCacheGlobal;
  state.novelSegmentLoads ||= new Map();
  const pending = state.novelSegmentLoads.get(key);
  if (pending) {
    return pending;
  }

  const loading = (async () => {
    const content = await readNovelContent(book);
    const segments = createNovelSegments(content);
    cacheNovelSegments(book, segments, Math.max(book.size_bytes, content.length * 2));
    return segments;
  })();
  state.novelSegmentLoads.set(key, loading);
  try {
    return await loading;
  } finally {
    if (state.novelSegmentLoads.get(key) === loading) {
      state.novelSegmentLoads.delete(key);
    }
  }
}
