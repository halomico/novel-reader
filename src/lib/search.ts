import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import { getExistingContentSearchDb, getLegacyContentSearchDb } from "./content-search-db";
import { findContentSearchCandidateNovelIds, type ContentSearchNovelRecord } from "./content-search-index";
import { getGlobalSearchMaxResults } from "./config";
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
  scanEngine?: "fts5";
  scanPhase?: "verify";
  cacheSegmentCount: number;
  results?: SearchResult[];
};

export type SearchNovelContentOptions = {
  isCancelled?: () => boolean;
  candidateNovelIds?: number[];
};

export type SearchNovelBookContentOptions = {
  maxResults?: number;
  isCancelled?: () => boolean;
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

export async function searchNovelBookContent(
  novel: SearchCandidate,
  query: ParsedSearchQuery,
  options: SearchNovelBookContentOptions = {},
): Promise<SearchResult[]> {
  const maxResults = Math.min(Math.max(Math.floor(options.maxResults || getGlobalSearchMaxResults()), 1), 1_000);
  const results: SearchResult[] = [];
  const documents = novel.storage_mode === "chapters"
    ? listNovelChapters(novel.id).map((chapter) => ({
        chapterId: chapter.id,
        title: chapter.title,
        read: () => readNovelChapterContent(chapter),
      }))
    : [{ chapterId: null, title: novel.title, read: () => readNovelContent(novel as Novel) }];

  for (const document of documents) {
    if (options.isCancelled?.()) throw new ContentSearchCancelledError();
    let content: string;
    try {
      content = await document.read();
    } catch {
      continue;
    }
    for (const segment of iterateNovelSegments(content)) {
      if (options.isCancelled?.()) throw new ContentSearchCancelledError();
      const normalizedContent = normalizeSearchText(segment.content);
      if (!normalizedContent.includes(query.anchorTerm) || !matchesParsedSearchQuery(segment.content, query, normalizedContent)) {
        continue;
      }
      results.push({
        novelId: novel.id,
        chapterId: document.chapterId,
        title: document.title,
        segmentIndex: segment.segmentIndex,
        snippet: createSearchSnippet(segment.content, query.highlightTerms),
      });
      if (results.length >= maxResults) return results;
    }
  }
  return results;
}

function listSearchIndexRecords(db: DatabaseSync): ContentSearchNovelRecord[] {
  return db
    .prepare("SELECT id, relative_path, source_id, storage_mode, content_hash, size_bytes, mtime_ms FROM novels ORDER BY id ASC")
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
  const scanEngine: SearchNovelContentProgress["scanEngine"] = "fts5";
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
      scanEngine: "fts5",
      scanPhase: "verify",
      cacheSegmentCount: 0,
      results: [],
    });
    return { results: [], searchedBooks: 0 };
  }
  const requiredIndexTerms = query.requiredTerms
    .filter((term) => !term.phrase && Array.from(term.normalized).length >= 2)
    .map((term) => term.normalized);

  const recordsBySource = new Map<number, ContentSearchNovelRecord[]>();
  for (const novel of novelRecords) {
    if (!Number.isInteger(novel.source_id) || Number(novel.source_id) < 1) continue;
    const sourceId = Number(novel.source_id);
    const current = recordsBySource.get(sourceId) || [];
    current.push(novel);
    recordsBySource.set(sourceId, current);
  }
  const candidateIds = new Set<number>();
  for (const [sourceId, sourceRecords] of recordsBySource) {
    try {
      const searchDb = getExistingContentSearchDb(sourceId) || getLegacyContentSearchDb();
      if (!searchDb) continue;
      const plan = findContentSearchCandidateNovelIds(searchDb, sourceRecords, requiredIndexTerms);
      if (!plan) continue;
      indexLabel ||= plan.terms.join(" + ");
      plan.candidateIds.forEach((novelId) => candidateIds.add(novelId));
    } catch {
      // A failed shard is isolated; other ready libraries remain searchable.
    }
  }
  candidates = listSearchCandidatesByIds(db, Array.from(candidateIds));

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
