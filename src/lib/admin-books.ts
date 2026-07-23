import { getConfiguredPaths } from "./config";
import { getDb } from "./db";
import { parseSearchQuery } from "./search-query";
import { buildTitleSearchSql, type Novel } from "./books";

export type AdminBookSortKey = "title" | "file_name" | "size_bytes" | "word_count" | "updated_at" | "visit_count" | "last_accessed_at";
export type AdminBookSortDir = "asc" | "desc";

export type AdminBookListResult = {
  books: Novel[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalPages: number;
  query: string;
  sort: AdminBookSortKey;
  dir: AdminBookSortDir;
  message?: string;
};

export type AdminBookStats = {
  totalBooks: number;
  totalSizeBytes: number;
  libraryDir: string;
  databasePath: string;
  adminSettingsPath: string;
};

function normalizePage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

function toPlainNovel(book: Novel): Novel {
  return {
    id: book.id,
    title: book.title,
    file_name: book.file_name,
    relative_path: book.relative_path,
    content_hash: book.content_hash,
    size_bytes: book.size_bytes,
    mtime_ms: book.mtime_ms,
    word_count: book.word_count,
    visit_count: book.visit_count,
    last_accessed_at: book.last_accessed_at,
    last_accessed_ip: book.last_accessed_ip,
    last_accessed_user_agent: book.last_accessed_user_agent,
    created_at: book.created_at,
    updated_at: book.updated_at,
  };
}

const sortColumns: Record<AdminBookSortKey, string> = {
  title: "title COLLATE NOCASE",
  file_name: "file_name COLLATE NOCASE",
  size_bytes: "size_bytes",
  word_count: "word_count",
  updated_at: "updated_at",
  visit_count: "visit_count",
  last_accessed_at: "last_accessed_at",
};

function normalizeSort(value: string | undefined): AdminBookSortKey {
  return value === "title" ||
    value === "file_name" ||
    value === "size_bytes" ||
    value === "word_count" ||
    value === "updated_at" ||
    value === "visit_count" ||
    value === "last_accessed_at"
    ? value
    : "updated_at";
}

function normalizeDir(value: string | undefined): AdminBookSortDir {
  return value === "asc" ? "asc" : "desc";
}

export function listAdminBooks(params: { page?: number; q?: string; pageSize?: number; sort?: string; dir?: string }): AdminBookListResult {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 20), 1), 200);
  const query = (params.q || "").trim();
  const sort = normalizeSort(params.sort);
  const dir = normalizeDir(params.dir);
  const orderBy = `${sortColumns[sort]} ${dir.toUpperCase()}, id ${dir === "asc" ? "ASC" : "DESC"}`;

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
        sort,
        dir,
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
    const totalPages = Math.max(1, Math.ceil(totalBooks.count / pageSize));
    const page = normalizePage(params.page || 1, totalPages);
    const offset = (page - 1) * pageSize;
    const books = db
      .prepare(
        `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
         FROM novels
         WHERE ${search.whereSql}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .all(...search.values, pageSize, offset) as Novel[];

    return {
      books: books.map(toPlainNovel),
      page,
      pageSize,
      totalBooks: totalBooks.count,
      totalPages,
      query: validation.keyword,
      sort,
      dir,
    };
  }

  const totalBooks = db.prepare("SELECT COUNT(*) AS count FROM novels").get() as { count: number };
  const totalPages = Math.max(1, Math.ceil(totalBooks.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const offset = (page - 1) * pageSize;
  const books = db
    .prepare(
      `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
       FROM novels
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, offset) as Novel[];

  return {
    books: books.map(toPlainNovel),
    page,
    pageSize,
    totalBooks: totalBooks.count,
    totalPages,
    query,
    sort,
    dir,
  };
}

export function getAdminBookStats(): AdminBookStats {
  const db = getDb();
  const paths = getConfiguredPaths();
  const total = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS size FROM novels").get() as {
    count: number;
    size: number;
  };
  return {
    totalBooks: total.count,
    totalSizeBytes: total.size,
    libraryDir: paths.libraryDir,
    databasePath: paths.databasePath,
    adminSettingsPath: paths.adminSettingsPath,
  };
}
