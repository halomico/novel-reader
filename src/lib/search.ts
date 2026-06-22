import { getDb } from "./db";
import { getGlobalSearchMaxResults } from "./config";

export type SearchValidation =
  | { ok: true; keyword: string; terms: string[] }
  | { ok: false; keyword: string; message: string };

export type SearchResult = {
  novelId: number;
  title: string;
  segmentIndex: number;
  snippet: string;
};

const MIN_SEARCH_CHARS = 2;
const MAX_SEARCH_CHARS = 30;

function countChars(value: string): number {
  return Array.from(value).length;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toFtsContentQuery(value: string): string {
  return `content : "${value.replace(/"/g, '""')}"`;
}

export function validateSearchKeyword(value: string | undefined): SearchValidation {
  const keyword = (value || "").trim();
  if (!keyword) {
    return { ok: false, keyword, message: "请输入正文搜索关键字" };
  }

  const length = countChars(keyword);
  if (length < MIN_SEARCH_CHARS || length > MAX_SEARCH_CHARS) {
    return { ok: false, keyword, message: "正文搜索关键字需要 2 到 30 个字" };
  }

  return {
    ok: true,
    keyword,
    terms: [keyword],
  };
}

export function normalizeSearchPage(value: string | number | undefined, totalPages: number): number {
  const page = Number(value || 1);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

export function createSnippet(content: string, keyword: string): string {
  const index = content.indexOf(keyword);
  if (index < 0) {
    return content.trim().slice(0, 140);
  }

  const start = Math.max(0, index - 56);
  const end = Math.min(content.length, index + keyword.length + 84);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < content.length ? "..." : "";
  return `${prefix}${content.slice(start, end).trim()}${suffix}`;
}

export function searchNovelContent(keyword: string): SearchResult[] {
  const db = getDb();
  const maxResults = getGlobalSearchMaxResults();
  const charLength = countChars(keyword);
  const rows =
    charLength >= 3
      ? db
          .prepare(
            `
            WITH hits AS (
              SELECT novel_id, MIN(segment_index) AS segment_index
              FROM novel_segments_fts
              WHERE novel_segments_fts MATCH ?
              GROUP BY novel_id
              ORDER BY novel_id ASC
              LIMIT ?
            )
            SELECT n.id AS novelId, n.title, s.segment_index AS segmentIndex, s.content
            FROM hits h
            JOIN novels n ON n.id = h.novel_id
            JOIN novel_segments s ON s.novel_id = h.novel_id AND s.segment_index = h.segment_index
            ORDER BY n.id ASC
          `,
          )
          .all(toFtsContentQuery(keyword), maxResults)
      : db
          .prepare(
            `
            WITH hits AS (
              SELECT novel_id, MIN(segment_index) AS segment_index
              FROM novel_segments
              WHERE content LIKE ? ESCAPE '\\'
              GROUP BY novel_id
              ORDER BY novel_id ASC
              LIMIT ?
            )
            SELECT n.id AS novelId, n.title, s.segment_index AS segmentIndex, s.content
            FROM hits h
            JOIN novels n ON n.id = h.novel_id
            JOIN novel_segments s ON s.novel_id = h.novel_id AND s.segment_index = h.segment_index
            ORDER BY n.id ASC
          `,
          )
          .all(`%${escapeLike(keyword)}%`, maxResults);

  return (rows as Array<{ novelId: number; title: string; segmentIndex: number; content: string }>).map((row) => ({
    novelId: row.novelId,
    title: row.title,
    segmentIndex: row.segmentIndex,
    snippet: createSnippet(row.content, keyword),
  }));
}
