import { getDb } from "./db";
import { getContentIndexMaxSegments, getGlobalSearchMaxResults, isFrontendAutoIndexEnabled } from "./config";
import {
  findBestIndexedContentTerm,
  getIndexedNovelIds,
  getContentIndexTermStatus,
  markContentIndexTermUsed,
  saveContentIndexTerm,
} from "./content-index";
import { getContentIndexDb } from "./content-index-db";
import { readNovelContent, type Novel } from "./books";
import { createNovelSegments } from "./segments";
import {
  createSearchSnippet,
  matchesParsedSearchQuery,
  normalizeSearchText,
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

export type SearchResultSet = {
  results: SearchResult[];
  searchedBooks: number;
};

export type SearchNovelContentProgress = {
  totalBooks: number;
  searchedBooks: number;
  resultCount: number;
  indexedTerm?: string;
  cacheSegmentCount: number;
};

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

export async function searchNovelContent(
  query: ParsedSearchQuery,
  onProgress?: (progress: SearchNovelContentProgress) => void,
): Promise<SearchResultSet> {
  const db = getDb();
  const indexDb = getContentIndexDb();
  const maxResults = getGlobalSearchMaxResults();
  const maxIndexSegments = getContentIndexMaxSegments();
  const results: SearchResult[] = [];
  const matchedNovelIds = new Set<number>();
  let searchedBooks = 0;

  function pushMatch(row: { novelId: number; title: string; segmentIndex: number; content: string }): boolean {
    if (matchedNovelIds.has(row.novelId) || !matchesParsedSearchQuery(row.content, query)) {
      return false;
    }

    matchedNovelIds.add(row.novelId);
    results.push({
      novelId: row.novelId,
      title: row.title,
      segmentIndex: row.segmentIndex,
      snippet: createSearchSnippet(row.content, query.highlightTerms),
    });

    return results.length >= maxResults;
  }

  const indexedTerm = findBestIndexedContentTerm(indexDb, query.anchorTerm);
  if (indexedTerm) {
    markContentIndexTermUsed(indexDb, indexedTerm.term);
  }
  const anchorStatus = getContentIndexTermStatus(indexDb, query.anchorTerm);
  const shouldCacheAnchor = isFrontendAutoIndexEnabled() && !anchorStatus;
  const cacheNovelIds = new Set<number>();
  let cacheSegmentCount = 0;
  let cacheLimitExceeded = false;
  const indexedNovelIds = indexedTerm ? new Set(getIndexedNovelIds(indexDb, indexedTerm.term)) : null;
  const candidates = (
    db
      .prepare(
        `
        SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, created_at, updated_at
        FROM novels
        ORDER BY id ASC
      `,
      )
      .all() as Novel[]
  ).filter((novel) => !indexedNovelIds || indexedNovelIds.has(novel.id));

  onProgress?.({
    totalBooks: candidates.length,
    searchedBooks,
    resultCount: results.length,
    indexedTerm: indexedTerm?.term,
    cacheSegmentCount,
  });

  for (const novel of candidates) {
    let content: string;
    try {
      content = await readNovelContent(novel);
    } catch {
      continue;
    }
    searchedBooks += 1;

    let novelHasAnchor = false;
    for (const segment of createNovelSegments(content)) {
      if (shouldCacheAnchor && !cacheLimitExceeded && normalizeSearchText(segment.content).includes(query.anchorTerm)) {
        cacheSegmentCount += 1;
        novelHasAnchor = true;
        cacheLimitExceeded = cacheSegmentCount > maxIndexSegments;
      }

      const reachedMaxResults =
        results.length < maxResults &&
        pushMatch({ novelId: novel.id, title: novel.title, segmentIndex: segment.segmentIndex, content: segment.content });
      if (reachedMaxResults && (!shouldCacheAnchor || cacheLimitExceeded)) {
        break;
      }
    }

    if (novelHasAnchor) {
      cacheNovelIds.add(novel.id);
    }

    onProgress?.({
      totalBooks: candidates.length,
      searchedBooks,
      resultCount: results.length,
      indexedTerm: indexedTerm?.term,
      cacheSegmentCount,
    });

    if (results.length >= maxResults && (!shouldCacheAnchor || cacheLimitExceeded)) {
      break;
    }
  }

  if (shouldCacheAnchor) {
    saveContentIndexTerm(indexDb, query.anchorTerm, cacheNovelIds, cacheSegmentCount, {
      maxSegments: maxIndexSegments,
      source: "auto",
    });
  }

  return { results, searchedBooks };
}
