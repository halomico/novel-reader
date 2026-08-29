import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";
import { readNovelContent, type Novel } from "./books";
import { listNovelChapters, readNovelChapterContent } from "./novel-library";
import { normalizeSearchText } from "./search-query";
import { iterateNovelSegments } from "./segments";

export const CONTENT_SEARCH_INDEX_VERSION = 3;
export const CONTENT_SEARCH_MAX_SOURCE_RATIO = 2.5;
const CONTENT_SEARCH_RATIO_MIN_SOURCE_BYTES = 10 * 1024 * 1024;
const CONTENT_SEARCH_QUERY_BATCH_SIZE = 512;

export type ContentSearchNovelRecord = Pick<
  Novel,
  "id" | "relative_path" | "source_id" | "storage_mode" | "content_hash" | "size_bytes" | "mtime_ms"
>;

type ContentSearchStateRow = {
  novelId: number;
  contentHash: string | null;
  sizeBytes: number;
  mtimeMs: number;
  indexVersion: number;
  indexedAt: string;
};

type ContentSearchFailureRow = {
  novelId: number;
  contentHash: string | null;
  sizeBytes: number;
  mtimeMs: number;
  indexVersion: number;
};

export type ContentSearchCandidatePlan = {
  engine: "fts5-bigram";
  terms: string[];
  candidateIds: number[];
  coveredNovelCount: number;
  uncoveredNovelCount: number;
};

export type ContentSearchCandidateSegment = {
  segmentId: number;
  novelId: number;
  chapterId: number | null;
  chapterTitle: string | null;
  segmentIndex: number;
  body: Uint8Array;
  contentHash: string | null;
  sizeBytes: number;
  mtimeMs: number;
  indexVersion: number;
};

export type ContentSearchSegmentBatch = {
  engine: "fts5-bigram";
  terms: string[];
  segments: ContentSearchCandidateSegment[];
  nextSegmentId: number;
};

export type ContentSearchIndexProgress = {
  totalBooks: number;
  processedBooks: number;
  indexedBooks: number;
  reusedBooks: number;
  failedBooks: number;
};

export type ContentSearchIndexResult = ContentSearchIndexProgress & {
  sourceBytes: number;
  databaseBytes: number;
};

export type ContentSearchIndexSummary = {
  totalBooks: number;
  indexedBooks: number;
  pendingBooks: number;
  staleBooks: number;
  failedBooks: number;
  sourceBytes: number;
  databaseBytes: number;
  databaseRatio: number;
  indexVersion: number;
  lastIndexedAt: string | null;
};

export type ContentSearchIndexBuildOptions = {
  force?: boolean;
  optimize?: boolean;
  isCancelled?: () => boolean;
  novelIds?: readonly number[];
  sourceId?: number;
};

type PreparedNovelIndex = {
  novel: ContentSearchNovelRecord;
  sourceChars: number;
  segments: Array<{
    chapterId: number | null;
    chapterTitle: string | null;
    segmentIndex: number;
    body: Uint8Array;
    bigramTokens: string;
  }>;
};

export class ContentSearchIndexCancelledError extends Error {
  constructor() {
    super("全文索引构建已取消");
    this.name = "ContentSearchIndexCancelledError";
  }
}

function relatedDatabasePaths(db: DatabaseSync): string[] {
  const databasePath = (db.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>)
    .find((item) => item.name === "main")?.file || "";
  if (!databasePath || databasePath === ":memory:") return [];
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function getContentSearchDiskUsageBytes(db: DatabaseSync): number {
  return relatedDatabasePaths(db).reduce((total, filePath) => total + fileSize(filePath), 0);
}

export function createBigramToken(left: string, right: string): string {
  return `${left}${right}`;
}

export function createBigramTokenDocument(normalizedContent: string): string {
  const tokens = new Set<string>();
  let previous = "";
  for (const char of normalizedContent) {
    if (previous) {
      tokens.add(createBigramToken(previous, char));
    }
    previous = char;
  }
  return Array.from(tokens).join(" ");
}

export function compressContentSearchSegment(content: string): Uint8Array {
  return brotliCompressSync(Buffer.from(content), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 },
  });
}

export function decompressContentSearchSegment(body: Uint8Array): string {
  return brotliDecompressSync(Buffer.from(body)).toString("utf8");
}

function listStates(db: DatabaseSync): ContentSearchStateRow[] {
  return db
    .prepare(
      `SELECT novel_id AS novelId, content_hash AS contentHash, size_bytes AS sizeBytes,
              mtime_ms AS mtimeMs, index_version AS indexVersion, indexed_at AS indexedAt
       FROM content_search_state`,
    )
    .all() as ContentSearchStateRow[];
}

function listFailures(db: DatabaseSync): ContentSearchFailureRow[] {
  return db
    .prepare(
      `SELECT novel_id AS novelId, content_hash AS contentHash, size_bytes AS sizeBytes,
              mtime_ms AS mtimeMs, index_version AS indexVersion
       FROM content_search_failures`,
    )
    .all() as ContentSearchFailureRow[];
}

function recordMatchesNovel(
  record: Pick<ContentSearchStateRow, "contentHash" | "sizeBytes" | "mtimeMs" | "indexVersion"> | undefined,
  novel: ContentSearchNovelRecord,
): boolean {
  return Boolean(
    record &&
      record.indexVersion === CONTENT_SEARCH_INDEX_VERSION &&
      record.contentHash === novel.content_hash &&
      record.sizeBytes === novel.size_bytes &&
      record.mtimeMs === novel.mtime_ms,
  );
}

function normalizeCandidateTerms(values: string | string[]): string[] {
  const terms = Array.isArray(values) ? values : [values];
  return Array.from(
    new Set(
      terms
        .map(normalizeSearchText)
        .filter((term) => Array.from(term).length >= 2),
    ),
  );
}

function buildBigramMatchQuery(terms: string[]): string {
  const tokens = new Set<string>();
  for (const term of terms) {
    const chars = Array.from(term);
    for (let index = 1; index < chars.length; index += 1) {
      tokens.add(createBigramToken(chars[index - 1], chars[index]));
    }
  }
  return Array.from(tokens)
    .map((token) => `"${token.replace(/"/g, '""')}"`)
    .join(" AND ");
}

export function findContentSearchCandidateSegments(
  db: DatabaseSync,
  requiredTerms: string | string[],
  options: { afterSegmentId?: number; limit?: number } = {},
): ContentSearchSegmentBatch | null {
  const terms = normalizeCandidateTerms(requiredTerms);
  if (!terms.length) return null;
  const afterSegmentId = Math.max(0, Math.floor(options.afterSegmentId || 0));
  const limit = Math.min(Math.max(Math.floor(options.limit || CONTENT_SEARCH_QUERY_BATCH_SIZE), 1), 2_048);

  try {
    const segments = db.prepare(
      `SELECT s.id AS segmentId, s.novel_id AS novelId, s.chapter_id AS chapterId,
              s.chapter_title AS chapterTitle, s.segment_index AS segmentIndex, s.body,
              st.content_hash AS contentHash, st.size_bytes AS sizeBytes,
              st.mtime_ms AS mtimeMs, st.index_version AS indexVersion
       FROM content_bigram_fts f
       JOIN content_search_segments s ON s.id = f.rowid
       JOIN content_search_state st ON st.novel_id = s.novel_id
       WHERE content_bigram_fts MATCH ? AND f.rowid > ? AND st.index_version = ?
       ORDER BY f.rowid ASC
       LIMIT ?`,
    ).all(
      buildBigramMatchQuery(terms),
      afterSegmentId,
      CONTENT_SEARCH_INDEX_VERSION,
      limit,
    ) as ContentSearchCandidateSegment[];
    return {
      engine: "fts5-bigram",
      terms,
      segments,
      nextSegmentId: segments.at(-1)?.segmentId || afterSegmentId,
    };
  } catch {
    return null;
  }
}

export function findContentSearchCandidateNovelIds(
  db: DatabaseSync,
  novels: ContentSearchNovelRecord[],
  requiredTerms: string | string[],
): ContentSearchCandidatePlan | null {
  const terms = normalizeCandidateTerms(requiredTerms);
  if (!terms.length || !novels.length) {
    return null;
  }

  const states = new Map(listStates(db).map((state) => [state.novelId, state]));
  const coveredIds = new Set<number>();
  for (const novel of novels) {
    if (recordMatchesNovel(states.get(novel.id), novel)) {
      coveredIds.add(novel.id);
    }
  }

  if (!coveredIds.size) {
    return null;
  }

  try {
    const matchedIds = new Set<number>();
    let afterSegmentId = 0;
    while (true) {
      const batch = findContentSearchCandidateSegments(db, terms, { afterSegmentId });
      if (!batch || !batch.segments.length) break;
      batch.segments.forEach((segment) => matchedIds.add(segment.novelId));
      if (batch.segments.length < CONTENT_SEARCH_QUERY_BATCH_SIZE || batch.nextSegmentId <= afterSegmentId) break;
      afterSegmentId = batch.nextSegmentId;
    }

    const candidateIds = Array.from(matchedIds).filter((novelId) => coveredIds.has(novelId));

    return {
      engine: "fts5-bigram",
      terms,
      candidateIds: candidateIds.sort((left, right) => left - right),
      coveredNovelCount: coveredIds.size,
      uncoveredNovelCount: novels.length - coveredIds.size,
    };
  } catch {
    return null;
  }
}

export function getContentSearchIndexSummary(
  mainDb: DatabaseSync,
  searchDb: DatabaseSync,
  options: { novelIds?: readonly number[]; sourceId?: number } = {},
): ContentSearchIndexSummary {
  const mainDatabase = (mainDb.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>)
    .find((item) => item.name === "main");
  if (mainDatabase?.file && options.novelIds === undefined) {
    try {
      const alias = "catalog_summary";
      const attached = (searchDb.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>)
        .find((item) => item.name === alias);
      if (attached && attached.file !== mainDatabase.file) {
        searchDb.exec(`DETACH DATABASE ${alias}`);
      }
      if (!attached || attached.file !== mainDatabase.file) {
        searchDb.prepare(`ATTACH DATABASE ? AS ${alias}`).run(mainDatabase.file);
      }

      const row = searchDb.prepare(
        `SELECT
           COUNT(*) AS total_books,
           COALESCE(SUM(n.size_bytes), 0) AS source_bytes,
           COALESCE(SUM(
             CASE WHEN s.novel_id IS NOT NULL
               AND s.content_hash IS n.content_hash
               AND s.size_bytes = n.size_bytes
               AND s.mtime_ms = n.mtime_ms
               AND s.index_version = ?
             THEN 1 ELSE 0 END
           ), 0) AS indexed_books,
           COALESCE(SUM(
             CASE WHEN s.novel_id IS NOT NULL
               AND NOT (
                 s.content_hash IS n.content_hash
                 AND s.size_bytes = n.size_bytes
                 AND s.mtime_ms = n.mtime_ms
                 AND s.index_version = ?
               )
             THEN 1 ELSE 0 END
           ), 0) AS stale_books,
           COALESCE(SUM(
             CASE WHEN f.novel_id IS NOT NULL
               AND f.content_hash IS n.content_hash
               AND f.size_bytes = n.size_bytes
               AND f.mtime_ms = n.mtime_ms
               AND f.index_version = ?
             THEN 1 ELSE 0 END
           ), 0) AS failed_books,
           MAX(
             CASE WHEN s.novel_id IS NOT NULL
               AND s.content_hash IS n.content_hash
               AND s.size_bytes = n.size_bytes
               AND s.mtime_ms = n.mtime_ms
               AND s.index_version = ?
             THEN s.indexed_at ELSE NULL END
           ) AS last_indexed_at
         FROM ${alias}.novels n
         LEFT JOIN content_search_state s ON s.novel_id = n.id
         LEFT JOIN content_search_failures f ON f.novel_id = n.id
         ${options.sourceId ? "WHERE n.source_id = ?" : ""}`,
      ).get(
        CONTENT_SEARCH_INDEX_VERSION,
        CONTENT_SEARCH_INDEX_VERSION,
        CONTENT_SEARCH_INDEX_VERSION,
        CONTENT_SEARCH_INDEX_VERSION,
        ...(options.sourceId ? [options.sourceId] : []),
      ) as {
        total_books: number;
        source_bytes: number;
        indexed_books: number;
        stale_books: number;
        failed_books: number;
        last_indexed_at: string | null;
      };
      const databaseBytes = getContentSearchDiskUsageBytes(searchDb);
      return {
        totalBooks: row.total_books,
        indexedBooks: row.indexed_books,
        pendingBooks: row.total_books - row.indexed_books,
        staleBooks: row.stale_books,
        failedBooks: row.failed_books,
        sourceBytes: row.source_bytes,
        databaseBytes,
        databaseRatio: row.source_bytes > 0 ? databaseBytes / row.source_bytes : 0,
        indexVersion: CONTENT_SEARCH_INDEX_VERSION,
        lastIndexedAt: row.last_indexed_at,
      };
    } catch {
      // In-memory and restricted SQLite connections use the row comparison below.
    }
  }

  const allowedNovelIds = options.novelIds === undefined
    ? null
    : new Set(options.novelIds.filter((id) => Number.isInteger(id) && id > 0));
  const novels = (mainDb
    .prepare(`SELECT id, relative_path, source_id, storage_mode, content_hash, size_bytes, mtime_ms
              FROM novels${options.sourceId ? " WHERE source_id = ?" : ""} ORDER BY id ASC`)
    .all(...(options.sourceId ? [options.sourceId] : [])) as ContentSearchNovelRecord[])
    .filter((novel) => !allowedNovelIds || allowedNovelIds.has(novel.id));
  const states = new Map(listStates(searchDb).map((state) => [state.novelId, state]));
  const failures = new Map(listFailures(searchDb).map((failure) => [failure.novelId, failure]));
  let indexedBooks = 0;
  let staleBooks = 0;
  let failedBooks = 0;
  let lastIndexedAt: string | null = null;

  for (const novel of novels) {
    const state = states.get(novel.id);
    if (recordMatchesNovel(state, novel)) {
      indexedBooks += 1;
      if (!lastIndexedAt || state!.indexedAt > lastIndexedAt) {
        lastIndexedAt = state!.indexedAt;
      }
    } else if (state) {
      staleBooks += 1;
    }
    if (recordMatchesNovel(failures.get(novel.id), novel)) {
      failedBooks += 1;
    }
  }

  const sourceBytes = novels.reduce((total, novel) => total + novel.size_bytes, 0);
  const databaseBytes = getContentSearchDiskUsageBytes(searchDb);
  return {
    totalBooks: novels.length,
    indexedBooks,
    pendingBooks: novels.length - indexedBooks,
    staleBooks,
    failedBooks,
    sourceBytes,
    databaseBytes,
    databaseRatio: sourceBytes > 0 ? databaseBytes / sourceBytes : 0,
    indexVersion: CONTENT_SEARCH_INDEX_VERSION,
    lastIndexedAt,
  };
}

function deleteNovelSegments(db: DatabaseSync, novelId: number) {
  const rows = db.prepare(
    "SELECT id FROM content_search_segments WHERE novel_id = ? ORDER BY id",
  ).all(novelId) as Array<{ id: number }>;
  const deleteFts = db.prepare("DELETE FROM content_bigram_fts WHERE rowid = ?");
  for (const row of rows) deleteFts.run(row.id);
  db.prepare("DELETE FROM content_search_segments WHERE novel_id = ?").run(novelId);
}

export function deleteContentSearchIndexNovel(db: DatabaseSync, novelId: number) {
  db.exec("BEGIN");
  try {
    deleteNovelSegments(db, novelId);
    db.prepare("DELETE FROM content_search_state WHERE novel_id = ?").run(novelId);
    db.prepare("DELETE FROM content_search_failures WHERE novel_id = ?").run(novelId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function clearContentSearchIndex(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    db.prepare("INSERT INTO content_bigram_fts(content_bigram_fts) VALUES(?)").run("delete-all");
    db.exec(`DELETE FROM content_search_segments; DELETE FROM content_search_state; DELETE FROM content_search_failures;`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function optimizeContentSearchIndex(db: DatabaseSync) {
  db.prepare("INSERT INTO content_bigram_fts(content_bigram_fts) VALUES(?)").run("optimize");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}

async function prepareNovelIndex(novel: ContentSearchNovelRecord): Promise<PreparedNovelIndex> {
  const documents = novel.storage_mode === "chapters"
    ? listNovelChapters(novel.id).map((chapter) => ({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        read: () => readNovelChapterContent(chapter),
      }))
    : [{ chapterId: null, chapterTitle: null, read: () => readNovelContent(novel) }];
  const segments: PreparedNovelIndex["segments"] = [];
  let sourceChars = 0;

  for (const document of documents) {
    const content = await document.read();
    sourceChars += content.length;
    for (const segment of iterateNovelSegments(content)) {
      const normalizedContent = normalizeSearchText(segment.content);
      segments.push({
        chapterId: document.chapterId,
        chapterTitle: document.chapterTitle,
        segmentIndex: segment.segmentIndex,
        body: compressContentSearchSegment(segment.content),
        bigramTokens: createBigramTokenDocument(normalizedContent),
      });
    }
  }
  return { novel, sourceChars, segments };
}

export async function buildContentSearchIndex(
  mainDb: DatabaseSync,
  searchDb: DatabaseSync,
  onProgress?: (progress: ContentSearchIndexProgress) => void,
  options: ContentSearchIndexBuildOptions = {},
): Promise<ContentSearchIndexResult> {
  const allowedNovelIds = options.novelIds === undefined
    ? null
    : new Set(options.novelIds.filter((id) => Number.isInteger(id) && id > 0));
  const novels = (mainDb
    .prepare(`SELECT id, relative_path, source_id, storage_mode, content_hash, size_bytes, mtime_ms
              FROM novels${options.sourceId ? " WHERE source_id = ?" : ""} ORDER BY id ASC`)
    .all(...(options.sourceId ? [options.sourceId] : [])) as ContentSearchNovelRecord[])
    .filter((novel) => !allowedNovelIds || allowedNovelIds.has(novel.id));
  const sourceBytes = novels.reduce((total, novel) => total + novel.size_bytes, 0);
  if (options.force) {
    clearContentSearchIndex(searchDb);
  }

  let stateRows = listStates(searchDb);
  if (stateRows.some((state) => state.indexVersion !== CONTENT_SEARCH_INDEX_VERSION)) {
    clearContentSearchIndex(searchDb);
    stateRows = [];
  }
  const states = new Map(stateRows.map((state) => [state.novelId, state]));
  const currentIds = new Set(novels.map((novel) => novel.id));
  const obsoleteIds = allowedNovelIds ? new Set<number>() : new Set([
    ...stateRows.filter((state) => !currentIds.has(state.novelId)).map((state) => state.novelId),
    ...listFailures(searchDb).filter((failure) => !currentIds.has(failure.novelId)).map((failure) => failure.novelId),
  ]);
  for (const novelId of obsoleteIds) {
    deleteContentSearchIndexNovel(searchDb, novelId);
  }

  let processedBooks = 0;
  let indexedBooks = 0;
  let reusedBooks = 0;
  let failedBooks = 0;
  let preparedChars = 0;
  const prepared: PreparedNovelIndex[] = [];
  const deleteState = searchDb.prepare("DELETE FROM content_search_state WHERE novel_id = ?");
  const deleteFailure = searchDb.prepare("DELETE FROM content_search_failures WHERE novel_id = ?");
  const insertSegment = searchDb.prepare(
    `INSERT INTO content_search_segments
       (novel_id, chapter_id, chapter_title, segment_index, body)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertBigram = searchDb.prepare("INSERT INTO content_bigram_fts(rowid, tokens) VALUES (?, ?)");
  const upsertState = searchDb.prepare(
    `INSERT INTO content_search_state (novel_id, content_hash, size_bytes, mtime_ms, index_version, indexed_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(novel_id) DO UPDATE SET
       content_hash = excluded.content_hash,
       size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms,
       index_version = excluded.index_version,
       indexed_at = CURRENT_TIMESTAMP`,
  );
  const upsertFailure = searchDb.prepare(
    `INSERT INTO content_search_failures
       (novel_id, content_hash, size_bytes, mtime_ms, index_version, error, attempted_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(novel_id) DO UPDATE SET
       content_hash = excluded.content_hash,
       size_bytes = excluded.size_bytes,
       mtime_ms = excluded.mtime_ms,
       index_version = excluded.index_version,
       error = excluded.error,
       attempted_at = CURRENT_TIMESTAMP`,
  );

  const emitProgress = () =>
    onProgress?.({ totalBooks: novels.length, processedBooks, indexedBooks, reusedBooks, failedBooks });
  const throwIfCancelled = () => {
    if (options.isCancelled?.()) {
      throw new ContentSearchIndexCancelledError();
    }
  };
  const flushPrepared = () => {
    if (!prepared.length) {
      return;
    }
    searchDb.exec("BEGIN");
    try {
      for (const item of prepared) {
        deleteNovelSegments(searchDb, item.novel.id);
        for (const segment of item.segments) {
          const inserted = insertSegment.run(
            item.novel.id,
            segment.chapterId,
            segment.chapterTitle,
            segment.segmentIndex,
            segment.body,
          );
          if (segment.bigramTokens) insertBigram.run(inserted.lastInsertRowid, segment.bigramTokens);
        }
        upsertState.run(
          item.novel.id,
          item.novel.content_hash,
          item.novel.size_bytes,
          item.novel.mtime_ms,
          CONTENT_SEARCH_INDEX_VERSION,
        );
        deleteFailure.run(item.novel.id);
        indexedBooks += 1;
      }
      searchDb.exec("COMMIT");
    } catch (error) {
      searchDb.exec("ROLLBACK");
      throw error;
    }
    prepared.length = 0;
    preparedChars = 0;
  };

  emitProgress();
  for (const novel of novels) {
    throwIfCancelled();
    if (!options.force && recordMatchesNovel(states.get(novel.id), novel)) {
      deleteFailure.run(novel.id);
      reusedBooks += 1;
      processedBooks += 1;
      if (processedBooks % 100 === 0) {
        emitProgress();
      }
      continue;
    }

    try {
      const item = await prepareNovelIndex(novel);
      prepared.push(item);
      preparedChars += item.sourceChars;
    } catch (error) {
      searchDb.exec("BEGIN");
      try {
        deleteNovelSegments(searchDb, novel.id);
        deleteState.run(novel.id);
        upsertFailure.run(
          novel.id,
          novel.content_hash,
          novel.size_bytes,
          novel.mtime_ms,
          CONTENT_SEARCH_INDEX_VERSION,
          (error instanceof Error ? error.message : String(error)).slice(0, 500),
        );
        searchDb.exec("COMMIT");
      } catch (writeError) {
        searchDb.exec("ROLLBACK");
        throw writeError;
      }
      failedBooks += 1;
    }
    processedBooks += 1;

    if (prepared.length >= 20 || preparedChars >= 8_000_000) {
      flushPrepared();
    }
    if (processedBooks % 100 === 0) {
      emitProgress();
    }
  }

  throwIfCancelled();
  flushPrepared();
  if (options.optimize !== false) {
    optimizeContentSearchIndex(searchDb);
  } else {
    searchDb.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }
  if (options.force) {
    throwIfCancelled();
    searchDb.exec("VACUUM;");
  }
  const databaseBytes = getContentSearchDiskUsageBytes(searchDb);
  if (
    sourceBytes >= CONTENT_SEARCH_RATIO_MIN_SOURCE_BYTES &&
    databaseBytes > sourceBytes * CONTENT_SEARCH_MAX_SOURCE_RATIO
  ) {
    throw new Error(`全文索引大小已超过原文的 ${CONTENT_SEARCH_MAX_SOURCE_RATIO} 倍，请停止使用并检查索引配置`);
  }
  emitProgress();
  return { totalBooks: novels.length, processedBooks, indexedBooks, reusedBooks, failedBooks, sourceBytes, databaseBytes };
}
