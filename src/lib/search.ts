import { getDb } from "./db";
import { getContentIndexMaxSegments, getGlobalSearchMaxResults, getLibraryDir, isFrontendAutoIndexEnabled } from "./config";
import { findIndexedContentCandidateNovelIds, getContentIndexTermStatus, markContentIndexTermUsed, saveContentIndexTerm } from "./content-index";
import { getContentIndexDb } from "./content-index-db";
import { getContentSearchDb } from "./content-search-db";
import { findContentSearchCandidateNovelIds } from "./content-search-index";
import { readNovelContent, type Novel } from "./books";
import { iterateNovelSegments } from "./segments";
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
  scanEngine?: "fts5" | "index" | "ripgrep" | "node";
  scanPhase?: "prefilter" | "verify";
  cacheSegmentCount: number;
  results?: SearchResult[];
};

export type SearchNovelContentOptions = {
  isCancelled?: () => boolean;
};

export class ContentSearchCancelledError extends Error {
  constructor() {
    super("Content search cancelled");
    this.name = "ContentSearchCancelledError";
  }
}

export function validateSearchKeyword(value: string | undefined): SearchValidation {
  return parseSearchQuery(value);
}

export async function searchNovelContent(
  query: ParsedSearchQuery,
  onProgress?: (progress: SearchNovelContentProgress) => void,
  options: SearchNovelContentOptions = {},
): Promise<SearchResultSet> {
  const db = getDb();
  const indexDb = getContentIndexDb();
  const maxResults = getGlobalSearchMaxResults();
  const maxIndexSegments = getContentIndexMaxSegments();
  const results: SearchResult[] = [];
  const matchedNovelIds = new Set<number>();
  let searchedBooks = 0;
  let candidates: Novel[] = [];
  let scanEngine: SearchNovelContentProgress["scanEngine"] = "node";
  let cacheSegmentCount = 0;
  let indexLabel: string | undefined;

  function throwIfCancelled() {
    if (options.isCancelled?.()) {
      throw new ContentSearchCancelledError();
    }
  }

  function emitProgress() {
    onProgress?.({
      totalBooks: candidates.length,
      searchedBooks,
      resultCount: results.length,
      indexedTerm: indexLabel,
      scanEngine,
      scanPhase: "verify",
      cacheSegmentCount,
      results: [...results],
    });
  }

  function pushMatch(row: { novelId: number; title: string; segmentIndex: number; content: string; normalizedContent: string }): boolean {
    if (matchedNovelIds.has(row.novelId) || !matchesParsedSearchQuery(row.content, query, row.normalizedContent)) {
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

  const allNovels = db
    .prepare(
      `
      SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
      FROM novels
      ORDER BY id ASC
    `,
    )
    .all() as Novel[];

  const indexedPlan = findIndexedContentCandidateNovelIds(
    indexDb,
    query.requiredTerms.filter((term) => !term.phrase && term.normalized).map((term) => term.normalized),
  );
  for (const indexedTerm of indexedPlan?.terms || []) {
    markContentIndexTermUsed(indexDb, indexedTerm);
  }

  let fullTextPlan: ReturnType<typeof findContentSearchCandidateNovelIds> = null;
  try {
    fullTextPlan = findContentSearchCandidateNovelIds(getContentSearchDb(), allNovels, query.anchorTerm);
  } catch {
    fullTextPlan = null;
  }

  const changedSinceIndex = indexedPlan ? allNovels.filter((novel) => novel.updated_at >= indexedPlan.indexedAt) : allNovels;
  const fallbackNovelCount = fullTextPlan?.uncoveredNovelCount ?? (indexedPlan ? changedSinceIndex.length : allNovels.length);
  const nativeRescanThreshold = Math.max(500, Math.floor(allNovels.length * 0.1));
  const shouldTryNativeScanner = (!fullTextPlan && !indexedPlan) || fallbackNovelCount > nativeRescanThreshold;
  let nativeCandidatePaths: Set<string> | null = null;

  if (shouldTryNativeScanner) {
    onProgress?.({
      totalBooks: allNovels.length,
      searchedBooks: 0,
      resultCount: 0,
      indexedTerm: fullTextPlan ? query.anchorTerm : indexedPlan?.terms.join(" + "),
      scanEngine: "ripgrep",
      scanPhase: "prefilter",
      cacheSegmentCount: 0,
      results: [],
    });
    try {
      const { scanContentCandidatePaths } = await import("./content-search-scanner.node");
      const scanResult = await scanContentCandidatePaths(getLibraryDir(), query.anchorTerm, options);
      throwIfCancelled();
      if (scanResult) {
        nativeCandidatePaths = scanResult.relativePaths;
        scanEngine = scanResult.engine;
      }
    } catch (error) {
      throwIfCancelled();
      if (error instanceof ContentSearchCancelledError) {
        throw error;
      }
    }
  }

  if (nativeCandidatePaths) {
    candidates = allNovels.filter((novel) => nativeCandidatePaths.has(novel.relative_path.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "")));
  } else if (fullTextPlan) {
    scanEngine = "fts5";
    indexLabel = query.anchorTerm;
    const fullTextCandidateIds = new Set(fullTextPlan.candidateIds);
    candidates = allNovels.filter((novel) => fullTextCandidateIds.has(novel.id));
  } else if (indexedPlan) {
    scanEngine = "index";
    indexLabel = indexedPlan.terms.join(" + ");
    const indexedNovelIds = new Set(indexedPlan.novelIds);
    candidates = allNovels.filter((novel) => indexedNovelIds.has(novel.id) || novel.updated_at >= indexedPlan.indexedAt);
  } else {
    scanEngine = "node";
    candidates = allNovels;
  }

  const anchorStatus = getContentIndexTermStatus(indexDb, query.anchorTerm);
  const anchorIndexIsStale = Boolean(
    anchorStatus?.status === "indexed" &&
      (!anchorStatus.updatedAt || allNovels.some((novel) => novel.updated_at >= (anchorStatus.updatedAt || ""))),
  );
  const shouldCacheAnchor =
    isFrontendAutoIndexEnabled() && (!anchorStatus || (anchorStatus.status === "indexed" && anchorIndexIsStale));
  const canCacheAnchor =
    shouldCacheAnchor &&
    (scanEngine === "ripgrep" ||
      (!fullTextPlan && !indexedPlan) ||
      Boolean(indexedPlan && indexedPlan.requestedTerms.length === 1 && indexedPlan.requestedTerms[0] === query.anchorTerm));
  const cacheNovelIds = new Set<number>();
  let cacheLimitExceeded = false;

  emitProgress();

  for (const novel of candidates) {
    throwIfCancelled();
    let content: string;
    try {
      content = await readNovelContent(novel);
    } catch {
      continue;
    }
    searchedBooks += 1;

    let novelHasAnchor = false;
    for (const segment of iterateNovelSegments(content)) {
      throwIfCancelled();
      const normalizedContent = normalizeSearchText(segment.content);
      const segmentHasAnchor = normalizedContent.includes(query.anchorTerm);
      if (canCacheAnchor && !cacheLimitExceeded && segmentHasAnchor) {
        cacheSegmentCount += 1;
        novelHasAnchor = true;
        cacheLimitExceeded = cacheSegmentCount > maxIndexSegments;
      }

      if (!segmentHasAnchor) {
        continue;
      }

      const beforeResultCount = results.length;
      const reachedMaxResults =
        results.length < maxResults &&
        pushMatch({
          novelId: novel.id,
          title: novel.title,
          segmentIndex: segment.segmentIndex,
          content: segment.content,
          normalizedContent,
        });
      if (results.length !== beforeResultCount && (reachedMaxResults || results.length <= 50 || results.length % 10 === 0)) {
        emitProgress();
      }
      if (reachedMaxResults && (!canCacheAnchor || cacheLimitExceeded)) {
        break;
      }
    }

    if (novelHasAnchor) {
      cacheNovelIds.add(novel.id);
    }

    emitProgress();

    if (results.length >= maxResults && (!canCacheAnchor || cacheLimitExceeded)) {
      break;
    }
  }

  if (canCacheAnchor) {
    throwIfCancelled();
    saveContentIndexTerm(indexDb, query.anchorTerm, cacheNovelIds, cacheSegmentCount, {
      maxSegments: maxIndexSegments,
      source: "auto",
    });
  }

  return { results, searchedBooks };
}
