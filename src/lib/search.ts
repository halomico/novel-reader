import { getDb } from "./db";
import { getGlobalSearchMaxResults } from "./config";
import {
  countSearchChars,
  createSearchSnippet,
  escapeLikePattern,
  matchesParsedSearchQuery,
  ParsedSearchQuery,
  parseSearchQuery,
  SearchQueryValidation,
} from "./search-query";

export type SearchValidation = SearchQueryValidation;

export type SearchResult = {
  novelId: number;
  title: string;
  segmentIndex: number;
  snippet: string;
};

function toFtsContentQuery(value: string): string {
  return `content : "${value.replace(/"/g, '""')}"`;
}

export function validateSearchKeyword(value: string | undefined): SearchValidation {
  return parseSearchQuery(value);
}

export function normalizeSearchPage(value: string | number | undefined, totalPages: number): number {
  const page = Number(value || 1);
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

function getCandidateLimit(maxResults: number): number {
  return Math.min(Math.max(maxResults * 80, 1000), 20000);
}

export function searchNovelContent(query: ParsedSearchQuery): SearchResult[] {
  const db = getDb();
  const maxResults = getGlobalSearchMaxResults();
  const candidateLimit = getCandidateLimit(maxResults);
  const charLength = countSearchChars(query.anchorTerm);
  const rows =
    charLength >= 3
      ? db
          .prepare(
            `
            SELECT n.id AS novelId, n.title, novel_segments_fts.segment_index AS segmentIndex, s.content
            FROM novel_segments_fts
            JOIN novels n ON n.id = novel_segments_fts.novel_id
            JOIN novel_segments s ON s.novel_id = novel_segments_fts.novel_id AND s.segment_index = novel_segments_fts.segment_index
              WHERE novel_segments_fts MATCH ?
            ORDER BY novel_segments_fts.novel_id ASC, novel_segments_fts.segment_index ASC
              LIMIT ?
          `,
          )
          .all(toFtsContentQuery(query.anchorTerm), candidateLimit)
      : db
          .prepare(
            `
            SELECT n.id AS novelId, n.title, s.segment_index AS segmentIndex, s.content
            FROM novel_segments s
            JOIN novels n ON n.id = s.novel_id
            WHERE s.content LIKE ? ESCAPE '\\'
            ORDER BY s.novel_id ASC, s.segment_index ASC
              LIMIT ?
          `,
          )
          .all(`%${escapeLikePattern(query.anchorTerm)}%`, candidateLimit);

  const results: SearchResult[] = [];
  const matchedNovelIds = new Set<number>();

  for (const row of rows as Array<{ novelId: number; title: string; segmentIndex: number; content: string }>) {
    if (matchedNovelIds.has(row.novelId) || !matchesParsedSearchQuery(row.content, query)) {
      continue;
    }

    matchedNovelIds.add(row.novelId);
    results.push({
      novelId: row.novelId,
      title: row.title,
      segmentIndex: row.segmentIndex,
      snippet: createSearchSnippet(row.content, query.highlightTerms),
    });

    if (results.length >= maxResults) {
      break;
    }
  }

  return results;
}
