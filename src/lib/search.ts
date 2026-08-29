import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import { getExistingContentSearchDb } from "./content-search-db";
import {
  CONTENT_SEARCH_INDEX_VERSION,
  decompressContentSearchSegment,
  findContentSearchCandidateSegments,
} from "./content-search-index";
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
type IndexedNovelCandidate = Pick<
  Novel,
  "id" | "title" | "source_id" | "content_hash" | "size_bytes" | "mtime_ms"
>;

const SQLITE_ID_CHUNK_SIZE = 400;
const SEARCH_PROGRESS_INTERVAL_MS = 300;
const SEARCH_SEGMENT_BATCH_SIZE = 512;

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

function listIndexedNovelCandidatesByIds(db: DatabaseSync, ids: number[]): IndexedNovelCandidate[] {
  if (!ids.length) {
    return [];
  }

  const candidates: IndexedNovelCandidate[] = [];
  for (let offset = 0; offset < ids.length; offset += SQLITE_ID_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + SQLITE_ID_CHUNK_SIZE);
    const placeholders = chunk.map(() => "?").join(", ");
    candidates.push(
      ...(db
        .prepare(`SELECT id, title, source_id, content_hash, size_bytes, mtime_ms
                  FROM novels WHERE id IN (${placeholders})`)
        .all(...chunk) as IndexedNovelCandidate[]),
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
  const verifiedNovelIds = new Set<number>();
  let searchedBooks = 0;
  let verifiedSegments = 0;
  const scanEngine: SearchNovelContentProgress["scanEngine"] = "fts5";
  let indexLabel: string | undefined;
  let lastProgressAt = 0;
  const allowedNovelIds = options.candidateNovelIds === undefined
    ? null
    : new Set(options.candidateNovelIds.filter((id) => Number.isInteger(id) && id > 0));
  const totalBooks = allowedNovelIds?.size || 0;

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
      totalBooks: Math.max(totalBooks, searchedBooks),
      searchedBooks,
      resultCount: results.length,
      indexedTerm: indexLabel,
      scanEngine,
      scanPhase: "verify",
      cacheSegmentCount: verifiedSegments,
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

  if (allowedNovelIds && !allowedNovelIds.size) {
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
  if (!requiredIndexTerms.length) requiredIndexTerms.push(query.anchorTerm);
  const sourceIds = (db.prepare(
    "SELECT DISTINCT source_id AS sourceId FROM novels WHERE source_id IS NOT NULL ORDER BY source_id",
  ).all() as Array<{ sourceId: number }>).map((row) => row.sourceId);

  emitProgress(true);
  for (const sourceId of sourceIds) {
    const searchDb = getExistingContentSearchDb(sourceId);
    if (!searchDb) continue;
    let afterSegmentId = 0;

    while (results.length < maxResults) {
      throwIfCancelled();
      const batch = findContentSearchCandidateSegments(searchDb, requiredIndexTerms, {
        afterSegmentId,
        limit: SEARCH_SEGMENT_BATCH_SIZE,
      });
      if (!batch || !batch.segments.length) break;
      indexLabel ||= batch.terms.join(" + ");

      const eligibleSegments = batch.segments.filter((segment) => (
        !allowedNovelIds || allowedNovelIds.has(segment.novelId)
      ));
      const candidateIds = Array.from(new Set(eligibleSegments.map((segment) => segment.novelId)));
      const candidates = new Map(
        listIndexedNovelCandidatesByIds(db, candidateIds).map((novel) => [novel.id, novel]),
      );

      for (const segment of eligibleSegments) {
        throwIfCancelled();
        if (matchedNovelIds.has(segment.novelId)) continue;
        const novel = candidates.get(segment.novelId);
        if (
          !novel ||
          novel.source_id !== sourceId ||
          segment.indexVersion !== CONTENT_SEARCH_INDEX_VERSION ||
          segment.contentHash !== novel.content_hash ||
          segment.sizeBytes !== novel.size_bytes ||
          segment.mtimeMs !== novel.mtime_ms
        ) {
          continue;
        }

        verifiedNovelIds.add(novel.id);
        searchedBooks = verifiedNovelIds.size;
        verifiedSegments += 1;
        let content: string;
        try {
          content = decompressContentSearchSegment(segment.body);
        } catch {
          continue;
        }
        const normalizedContent = normalizeSearchText(content);
        if (!normalizedContent.includes(query.anchorTerm)) continue;
        const reachedMaxResults = pushMatch({
          novelId: novel.id,
          chapterId: segment.chapterId,
          title: segment.chapterTitle || novel.title,
          segmentIndex: segment.segmentIndex,
          content,
          normalizedContent,
        });
        if (reachedMaxResults) break;
      }

      emitProgress();
      if (
        results.length >= maxResults ||
        batch.segments.length < SEARCH_SEGMENT_BATCH_SIZE ||
        batch.nextSegmentId <= afterSegmentId
      ) {
        break;
      }
      afterSegmentId = batch.nextSegmentId;
    }
    if (results.length >= maxResults) break;
  }

  emitProgress(true);
  return { results, searchedBooks };
}
