import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import { getContentSearchDb } from "./content-search-db";
import { findContentSearchCandidateNovelIds, type ContentSearchNovelRecord } from "./content-search-index";
import { getGlobalSearchMaxResults, getLibraryDir } from "./config";
import { getDb } from "./db";
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
  scanEngine?: "fts5" | "ripgrep" | "node";
  scanPhase?: "prefilter" | "verify";
  cacheSegmentCount: number;
  results?: SearchResult[];
};

export type SearchNovelContentOptions = {
  isCancelled?: () => boolean;
};

type SearchCandidate = Pick<Novel, "id" | "title" | "relative_path">;

const SQLITE_ID_CHUNK_SIZE = 400;

export class ContentSearchCancelledError extends Error {
  constructor() {
    super("Content search cancelled");
    this.name = "ContentSearchCancelledError";
  }
}

export function validateSearchKeyword(value: string | undefined): SearchValidation {
  return parseSearchQuery(value);
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
}

function listSearchIndexRecords(db: DatabaseSync): ContentSearchNovelRecord[] {
  return db
    .prepare("SELECT id, relative_path, content_hash, size_bytes, mtime_ms FROM novels ORDER BY id ASC")
    .all() as ContentSearchNovelRecord[];
}

function listSearchCandidatesByIds(db: DatabaseSync, ids: number[]): SearchCandidate[] {
  if (!ids.length) {
    return [];
  }

  const candidates: SearchCandidate[] = [];
  for (let offset = 0; offset < ids.length; offset += SQLITE_ID_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + SQLITE_ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    candidates.push(
      ...(db
        .prepare(`SELECT id, title, relative_path FROM novels WHERE id IN (${placeholders})`)
        .all(...chunk) as SearchCandidate[]),
    );
  }
  return candidates.sort((left, right) => left.id - right.id);
}

function listAllSearchCandidates(db: DatabaseSync): SearchCandidate[] {
  return db.prepare("SELECT id, title, relative_path FROM novels ORDER BY id ASC").all() as SearchCandidate[];
}

export async function searchNovelContent(
  query: ParsedSearchQuery,
  onProgress?: (progress: SearchNovelContentProgress) => void,
  options: SearchNovelContentOptions = {},
): Promise<SearchResultSet> {
  const db = getDb();
  const maxResults = getGlobalSearchMaxResults();
  const results: SearchResult[] = [];
  const matchedNovelIds = new Set<number>();
  let searchedBooks = 0;
  let candidates: SearchCandidate[] = [];
  let scanEngine: SearchNovelContentProgress["scanEngine"] = "node";
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
      cacheSegmentCount: 0,
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

  const novelRecords = listSearchIndexRecords(db);
  const requiredIndexTerms = query.requiredTerms
    .filter((term) => !term.phrase && Array.from(term.normalized).length >= 2)
    .map((term) => term.normalized);

  let fullTextPlan: ReturnType<typeof findContentSearchCandidateNovelIds> = null;
  try {
    fullTextPlan = findContentSearchCandidateNovelIds(getContentSearchDb(), novelRecords, requiredIndexTerms);
  } catch {
    fullTextPlan = null;
  }

  const fallbackNovelCount = fullTextPlan?.uncoveredNovelCount ?? novelRecords.length;
  const nativeRescanThreshold = Math.max(500, Math.floor(novelRecords.length * 0.1));
  const shouldTryNativeScanner = !fullTextPlan || fallbackNovelCount > nativeRescanThreshold;
  let nativeCandidatePaths: Set<string> | null = null;

  if (shouldTryNativeScanner) {
    onProgress?.({
      totalBooks: novelRecords.length,
      searchedBooks: 0,
      resultCount: 0,
      indexedTerm: fullTextPlan?.terms.join(" + "),
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
    const candidateIds = novelRecords
      .filter((novel) => nativeCandidatePaths!.has(normalizeRelativePath(novel.relative_path)))
      .map((novel) => novel.id);
    candidates = listSearchCandidatesByIds(db, candidateIds);
  } else if (fullTextPlan) {
    scanEngine = "fts5";
    indexLabel = fullTextPlan.terms.join(" + ");
    candidates = listSearchCandidatesByIds(db, fullTextPlan.candidateIds);
  } else {
    scanEngine = "node";
    candidates = listAllSearchCandidates(db);
  }

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

    let reachedMaxResults = false;
    for (const segment of iterateNovelSegments(content)) {
      throwIfCancelled();
      const normalizedContent = normalizeSearchText(segment.content);
      if (!normalizedContent.includes(query.anchorTerm)) {
        continue;
      }

      const beforeResultCount = results.length;
      reachedMaxResults =
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
      if (reachedMaxResults) {
        break;
      }
    }

    emitProgress();
    if (reachedMaxResults) {
      break;
    }
  }

  return { results, searchedBooks };
}
