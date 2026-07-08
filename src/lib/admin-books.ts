import { getConfiguredPaths } from "./config";
import { getDb } from "./db";
import { matchesParsedSearchQuery, parseSearchQuery } from "./search-query";
import type { Novel } from "./books";

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
  indexedBooks: number;
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

function compareAdminBooks(sort: AdminBookSortKey, dir: AdminBookSortDir) {
  const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });
  const direction = dir === "asc" ? 1 : -1;

  return (left: Novel, right: Novel) => {
    let result = 0;
    if (sort === "size_bytes") {
      result = left.size_bytes - right.size_bytes;
    } else if (sort === "word_count") {
      result = left.word_count - right.word_count;
    } else if (sort === "visit_count") {
      result = left.visit_count - right.visit_count;
    } else if (sort === "last_accessed_at") {
      result = new Date(left.last_accessed_at || 0).getTime() - new Date(right.last_accessed_at || 0).getTime();
    } else if (sort === "updated_at") {
      result = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
    } else if (sort === "file_name") {
      result = collator.compare(left.file_name, right.file_name);
    } else {
      result = collator.compare(left.title, right.title);
    }
    return result === 0 ? left.id - right.id : result * direction;
  };
}

export function listAdminBooks(params: { page?: number; q?: string; pageSize?: number; sort?: string; dir?: string }): AdminBookListResult {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 20), 1), 100);
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

    const candidates = db
      .prepare(
        `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
         FROM novels
         ORDER BY ${orderBy}`,
      )
      .all() as Novel[];
    const matchedBooks = candidates.filter((book) => matchesParsedSearchQuery(book.title, validation.query)).sort(compareAdminBooks(sort, dir));
    const totalPages = Math.max(1, Math.ceil(matchedBooks.length / pageSize));
    const page = normalizePage(params.page || 1, totalPages);
    const offset = (page - 1) * pageSize;

    return {
      books: matchedBooks.slice(offset, offset + pageSize).map(toPlainNovel),
      page,
      pageSize,
      totalBooks: matchedBooks.length,
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
  const indexed = db.prepare("SELECT COUNT(*) AS count FROM search_index_state WHERE status = 'indexed'").get() as { count: number };

  return {
    totalBooks: total.count,
    indexedBooks: indexed.count,
    totalSizeBytes: total.size,
    libraryDir: paths.libraryDir,
    databasePath: paths.databasePath,
    adminSettingsPath: paths.adminSettingsPath,
  };
}
