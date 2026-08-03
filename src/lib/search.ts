import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import { getContentSearchDb } from "./content-search-db";
import { findContentSearchCandidateNovelIds, type ContentSearchNovelRecord } from "./content-search-index";
import { getGlobalSearchMaxResults, getLibraryDir } from "./config";
import { getDb } from "./db";
import { listNovelChapters, readNovelChapterContent } from "./novel-library";
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
  chapterId?: number | null;
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
  candidateNovelIds?: number[];
};

type SearchCandidate = Pick<Novel, "id" | "title" | "relative_path" | "storage_mode">;

const SQLITE_ID_CHUNK_SIZE = 400;
const SEARCH_PROGRESS_INTERVAL_MS = 300;

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
    .prepare("SELECT id, relative_path, storage_mode, content_hash, size_bytes, mtime_ms FROM novels ORDER BY id ASC")
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
        .prepare(`SELECT id, title, relative_path, storage_mode FROM novels WHERE id IN (${placeholders})`)
        .all(...chunk) as SearchCandidate[]),
    );
  }
  return candidates.sort((left, right) => left.id - right.id);
}

function listAllSearchCandidates(db: DatabaseSync): SearchCandidate[] {
  return db.prepare("SELECT id, title, relative_path, storage_mode FROM novels ORDER BY id ASC").all() as SearchCandidate[];
}

function listNovelIdsByCandidatePaths(db: DatabaseSync, paths: Set<string>): number[] {
  const values = Array.from(paths);
  const ids = new Set<number>();
  for (let offset = 0; offset < values.length; offset += SQLITE_ID_CHUNK_SIZE) {
    const chunk = values.slice(offset, offset + SQLITE_ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = db.prepare(
      `SELECT id AS novel_id FROM novels WHERE relative_path IN (${placeholders})
       UNION
       SELECT novel_id FROM novel_chapters WHERE relative_path IN (${placeholders})`,
    ).all(...chunk, ...chunk) as Array<{ novel_id: number }>;
    rows.forEach((row) => ids.add(row.novel_id));
  }
  return Array.from(ids);
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
  let lastProgressAt = 0;

  function throwIfCancelled() {
    if (options.isCancelled?.()) {
      throw new ContentSearchCancelledError();
    }
  }

  function emitProgress(force = false) {
    const now = Date.now();
    if (!force && now - lastProgressAt < SEARCH_PROGRESS_INTERVAL_MS) {
      return;
    }
    lastProgressAt = now;
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

  function pushMatch(row: { novelId: number; chapterId: number | null; title: string; segmentIndex: number; content: string; normalizedContent: string }): boolean {
    if (matchedNovelIds.has(row.novelId) || !matchesParsedSearchQuery(row.content, query, row.normalizedContent)) {
      return false;
    }

    matchedNovelIds.add(row.novelId);
    results.push({
      novelId: row.novelId,
      chapterId: row.chapterId,
      title: row.title,
      segmentIndex: row.segmentIndex,
      snippet: createSearchSnippet(row.content, query.highlightTerms),
    });
    return results.length >= maxResults;
  }

  const allowedNovelIds = options.candidateNovelIds === undefined
    ? null
    : new Set(options.candidateNovelIds.filter((id) => Number.isInteger(id) && id > 0));
  const novelRecords = listSearchIndexRecords(db).filter((novel) => !allowedNovelIds || allowedNovelIds.has(novel.id));
  if (!novelRecords.length) {
    onProgress?.({
      totalBooks: 0,
      searchedBooks: 0,
      resultCount: 0,
      scanEngine: "node",
      scanPhase: "verify",
      cacheSegmentCount: 0,
      results: [],
    });
    return { results: [], searchedBooks: 0 };
  }
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
    const allowedIds = new Set(novelRecords.map((novel) => novel.id));
    const candidateIds = listNovelIdsByCandidatePaths(
      db,
      new Set(Array.from(nativeCandidatePaths, normalizeRelativePath)),
    ).filter((id) => allowedIds.has(id));
    candidates = listSearchCandidatesByIds(db, candidateIds);
  } else if (fullTextPlan) {
    scanEngine = "fts5";
    indexLabel = fullTextPlan.terms.join(" + ");
    candidates = listSearchCandidatesByIds(db, fullTextPlan.candidateIds);
  } else {
    scanEngine = "node";
    candidates = allowedNovelIds
      ? listSearchCandidatesByIds(db, novelRecords.map((novel) => novel.id))
      : listAllSearchCandidates(db);
  }

  emitProgress(true);
  for (const novel of candidates) {
    throwIfCancelled();
    let reachedMaxResults = false;
    const documents = novel.storage_mode === "chapters"
      ? listNovelChapters(novel.id).map((chapter) => ({
          chapterId: chapter.id,
          read: () => readNovelChapterContent(chapter),
        }))
      : [{ chapterId: null, read: () => readNovelContent(novel) }];
    for (const document of documents) {
      let content: string;
      try {
        content = await document.read();
      } catch {
        continue;
      }
      for (const segment of iterateNovelSegments(content)) {
        throwIfCancelled();
        const normalizedContent = normalizeSearchText(segment.content);
        if (!normalizedContent.includes(query.anchorTerm)) continue;
        const beforeResultCount = results.length;
        reachedMaxResults = results.length < maxResults && pushMatch({
          novelId: novel.id,
          chapterId: document.chapterId,
          title: novel.title,
          segmentIndex: segment.segmentIndex,
          content: segment.content,
          normalizedContent,
        });
        if (results.length !== beforeResultCount) emitProgress(reachedMaxResults);
        if (reachedMaxResults) break;
      }
      if (matchedNovelIds.has(novel.id) || reachedMaxResults) break;
    }
    searchedBooks += 1;

    emitProgress();
    if (reachedMaxResults) {
      break;
    }
  }

  return { results, searchedBooks };
}
