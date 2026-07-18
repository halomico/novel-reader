import fs from "node:fs/promises";
import path from "node:path";
import { getLibraryDir } from "./config";
import { getDb } from "./db";
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

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function listRandomNovels(pageSize: number, seed: string, totalBooks: number): Novel[] {
  if (totalBooks <= 0) {
    return [];
  }
  const db = getDb();
  const bounds = db.prepare("SELECT MIN(id) AS min_id, MAX(id) AS max_id FROM novels").get() as {
    min_id: number;
    max_id: number;
  };
  const target = Math.min(pageSize, totalBooks);
  const random = seededRandom(seed);
  const selectAtOrAfter = db.prepare(
    `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
     FROM novels
     WHERE id >= ?
     ORDER BY id ASC
     LIMIT 1`,
  );
  const selected = new Map<number, Novel>();
  const attempts = Math.max(32, target * 8);
  for (let attempt = 0; attempt < attempts && selected.size < target; attempt += 1) {
    const pivot = bounds.min_id + Math.floor(random() * (bounds.max_id - bounds.min_id + 1));
    const book = selectAtOrAfter.get(pivot) as Novel | undefined;
    if (book) {
      selected.set(book.id, book);
    }
  }

  if (selected.size < target) {
    const excludedIds = Array.from(selected.keys());
    const placeholders = excludedIds.map(() => "?").join(", ");
    const where = placeholders ? `WHERE id NOT IN (${placeholders})` : "";
    const remaining = db
      .prepare(
        `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
         FROM novels
         ${where}
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(...excludedIds, target - selected.size) as Novel[];
    remaining.forEach((book) => selected.set(book.id, book));
  }

  return Array.from(selected.values());
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
      books: listRandomNovels(pageSize, randomSeed, totalBooks.count),
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

  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash, n.size_bytes, n.mtime_ms, n.word_count, n.visit_count, n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent, n.created_at, n.updated_at
       FROM novels n
       LEFT JOIN pinned_novels p ON p.novel_id = n.id
       ORDER BY CASE WHEN p.novel_id IS NULL THEN 1 ELSE 0 END ASC, p.sort_order ASC, n.title COLLATE NOCASE ASC, n.id ASC
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
