import fs from "node:fs/promises";
import path from "node:path";
import { getCatalogFeatureSettings, getLibraryDir } from "./config";
import { getDb } from "./db";
import { sampleNovelIds } from "./novel-id-sampler";
import { createNovelSegments, NovelSegment } from "./segments";
import { parseSearchQuery, type ParsedSearchQuery, type SearchExpression } from "./search-query";
import { decodeNovelBuffer } from "./text";

export type Novel = {
  id: number;
  title: string;
  file_name: string;
  relative_path: string;
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

function listRandomNovels(pageSize: number, seed: string): Novel[] {
  const db = getDb();
  const selectedIds = sampleNovelIds(db, pageSize, seed);
  if (!selectedIds.length) {
    return [];
  }
  const placeholders = selectedIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
       FROM novels
       WHERE id IN (${placeholders})`,
    )
    .all(...selectedIds) as Novel[];
  const byId = new Map(rows.map((book) => [book.id, book]));
  return selectedIds.flatMap((id) => {
    const book = byId.get(id);
    return book ? [book] : [];
  });
}

function listCatalogNovels(pageSize: number, offset: number): Novel[] {
  const db = getDb();
  const settings = getCatalogFeatureSettings();
  const pinnedIds = settings.manualPinnedEnabled && settings.randomRecommendationsEnabled
    ? new Set((db.prepare("SELECT novel_id FROM pinned_novels").all() as Array<{ novel_id: number }>).map((row) => row.novel_id))
    : new Set<number>();
  const intervalMs = settings.randomRecommendationIntervalMinutes * 60_000;
  const recommendationIds = settings.randomRecommendationsEnabled
    ? sampleNovelIds(
        db,
        settings.randomRecommendationCount,
        `catalog-recommendations:${Math.floor(Date.now() / intervalMs)}`,
        pinnedIds,
      )
    : [];
  const recommendationValues = recommendationIds.length
    ? `VALUES ${recommendationIds.map(() => "(?, ?)").join(", ")}`
    : "SELECT NULL, NULL WHERE 0";
  const recommendationParams = recommendationIds.flatMap((id, index) => [id, index]);
  const pinnedJoin = settings.manualPinnedEnabled
    ? "LEFT JOIN pinned_novels p ON p.novel_id = n.id"
    : "";
  const pinnedPriority = settings.manualPinnedEnabled
    ? "WHEN p.novel_id IS NOT NULL THEN 0"
    : "";
  const recommendationPriority = settings.manualPinnedEnabled ? 1 : 0;
  const defaultPriority = recommendationPriority + 1;
  const pinnedOrder = settings.manualPinnedEnabled ? "p.sort_order ASC," : "";

  return db
    .prepare(
      `WITH recommended(novel_id, sort_order) AS (${recommendationValues})
       SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash, n.size_bytes, n.mtime_ms, n.word_count, n.visit_count, n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent, n.created_at, n.updated_at
       FROM novels n
       ${pinnedJoin}
       LEFT JOIN recommended r ON r.novel_id = n.id
       ORDER BY CASE
         ${pinnedPriority}
         WHEN r.novel_id IS NOT NULL THEN ${recommendationPriority}
         ELSE ${defaultPriority}
       END ASC,
       ${pinnedOrder}
       r.sort_order ASC,
       n.title COLLATE NOCASE ASC,
       n.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...recommendationParams, pageSize, offset) as Novel[];
}

export function listNovels(params: { page?: number; q?: string; pageSize?: number; randomSeed?: string }): NovelListResult {
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
    const totalBooks = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM novels
         WHERE ${search.whereSql}`,
      )
      .get(...search.values) as { count: number };
    const totalPages = Math.ceil(totalBooks.count / pageSize);
    const page = normalizePage(params.page || 1, totalPages);
    const offset = (page - 1) * pageSize;
    const books = db
      .prepare(
        `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
         FROM novels
         WHERE ${search.whereSql}
         ORDER BY title COLLATE NOCASE ASC, id ASC
         LIMIT ? OFFSET ?`,
      )
      .all(...search.values, pageSize, offset) as Novel[];

    return {
      books,
      page,
      pageSize,
      totalBooks: totalBooks.count,
      totalPages: Math.max(totalPages, 1),
      query: validation.keyword,
    };
  }

  const totalBooks = db
    .prepare("SELECT COUNT(*) AS count FROM novels")
    .get() as { count: number };
  const randomSeed = (params.randomSeed || "").trim().slice(0, 64);
  if (randomSeed) {
    return {
      books: listRandomNovels(pageSize, randomSeed),
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

  const books = listCatalogNovels(pageSize, offset);

  return {
    books,
    page,
    pageSize,
    totalBooks: totalBooks.count,
    totalPages: Math.max(totalPages, 1),
    query,
  };
}

export function getNovelById(id: number): Novel | null {
  const db = getDb();
  const book = db
    .prepare(
      `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
       FROM novels
       WHERE id = ?`,
    )
    .get(id) as Novel | undefined;

  return book || null;
}

export async function readNovelContent(book: Pick<Novel, "relative_path">): Promise<string> {
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
  const content = await readNovelContent(book);
  return createNovelSegments(content);
}
