import fs from "node:fs/promises";
import path from "node:path";
import { getLibraryDir } from "./config";
import { getDb } from "./db";
import { createNovelSegments, NovelSegment } from "./segments";
import { matchesParsedSearchQuery, parseSearchQuery } from "./search-query";
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
const MAX_PAGE_SIZE = 50;

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

export function listNovels(params: { page?: number; q?: string; pageSize?: number }): NovelListResult {
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

    const candidates = db
      .prepare(
        `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, created_at, updated_at
         FROM novels
         ORDER BY title COLLATE NOCASE ASC, id ASC`,
      )
      .all() as Novel[];
    const matchedBooks = candidates.filter((book) => matchesParsedSearchQuery(book.title, validation.query));
    const totalPages = Math.ceil(matchedBooks.length / pageSize);
    const page = normalizePage(params.page || 1, totalPages);
    const offset = (page - 1) * pageSize;

    return {
      books: matchedBooks.slice(offset, offset + pageSize),
      page,
      pageSize,
      totalBooks: matchedBooks.length,
      totalPages: Math.max(totalPages, 1),
      query: validation.keyword,
    };
  }

  const totalBooks = db
    .prepare("SELECT COUNT(*) AS count FROM novels")
    .get() as { count: number };
  const totalPages = Math.ceil(totalBooks.count / pageSize);
  const page = normalizePage(params.page || 1, totalPages);
  const offset = (page - 1) * pageSize;

  const books = db
    .prepare(
      `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, created_at, updated_at
       FROM novels
       ORDER BY title COLLATE NOCASE ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(pageSize, offset) as Novel[];

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
      `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, created_at, updated_at
       FROM novels
       WHERE id = ?`,
    )
    .get(id) as Novel | undefined;

  return book || null;
}

export async function readNovelContent(book: Novel): Promise<string> {
  const libraryDir = getLibraryDir();
  const filePath = path.resolve(libraryDir, book.relative_path);
  const libraryRoot = path.resolve(libraryDir);

  if (filePath !== libraryRoot && !filePath.startsWith(`${libraryRoot}${path.sep}`)) {
    throw new Error("小说文件路径不在书库目录内");
  }

  const buffer = await fs.readFile(filePath);
  return decodeNovelBuffer(buffer);
}

export async function readNovelSegments(book: Novel): Promise<NovelSegment[]> {
  const content = await readNovelContent(book);
  return createNovelSegments(content);
}
