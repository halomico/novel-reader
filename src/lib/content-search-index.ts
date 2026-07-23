import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import { getContentSearchDatabasePath } from "./config";
import { normalizeSearchText } from "./search-query";

export const CONTENT_SEARCH_INDEX_VERSION = 1;
export const CONTENT_SEARCH_MAX_SOURCE_RATIO = 5;
const CONTENT_SEARCH_RATIO_MIN_SOURCE_BYTES = 10 * 1024 * 1024;

export type ContentSearchNovelRecord = Pick<
  Novel,
  "id" | "relative_path" | "content_hash" | "size_bytes" | "mtime_ms"
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
  engine: "fts5-bigram" | "fts5-trigram" | "fts5-hybrid";
  terms: string[];
  candidateIds: number[];
  coveredNovelCount: number;
  uncoveredNovelCount: number;
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
};

type PreparedNovelIndex = {
  novel: ContentSearchNovelRecord;
  normalizedContent: string;
  bigramTokens: string;
};

export class ContentSearchIndexCancelledError extends Error {
  constructor() {
    super("全文索引构建已取消");
    this.name = "ContentSearchIndexCancelledError";
  }
}

function relatedDatabasePaths(): string[] {
  const databasePath = getContentSearchDatabasePath();
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export function getContentSearchDiskUsageBytes(): number {
  return relatedDatabasePaths().reduce((total, filePath) => total + fileSize(filePath), 0);
}

function codePointToken(char: string): string {
  return (char.codePointAt(0) || 0).toString(16).padStart(6, "0");
}

export function createBigramToken(left: string, right: string): string {
  return `b${codePointToken(left)}${codePointToken(right)}`;
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

export function createCharacterNgrams(value: string, size: number): string[] {
  const chars = Array.from(value);
  const seen = new Set<string>();
  for (let index = 0; index <= chars.length - size; index += 1) {
    seen.add(chars.slice(index, index + size).join(""));
  }
  return Array.from(seen);
}

export function buildTrigramMatchQuery(normalizedTerm: string): string {
  return createCharacterNgrams(normalizedTerm, 3)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" AND ");
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

function queryCoveredIds(db: DatabaseSync, term: string): { engine: "bigram" | "trigram"; ids: Set<number> } {
  const chars = Array.from(term);
  const rows =
    chars.length === 2
      ? (db
          .prepare("SELECT rowid AS novelId FROM content_bigram_fts WHERE content_bigram_fts MATCH ? ORDER BY rowid")
          .all(createBigramToken(chars[0], chars[1])) as Array<{ novelId: number }>)
      : (db
          .prepare("SELECT rowid AS novelId FROM content_trigram_fts WHERE content_trigram_fts MATCH ? ORDER BY rowid")
          .all(buildTrigramMatchQuery(term)) as Array<{ novelId: number }>);

  return { engine: chars.length === 2 ? "bigram" : "trigram", ids: new Set(rows.map((row) => row.novelId)) };
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
  const candidateIds = new Set<number>();
  for (const novel of novels) {
    if (recordMatchesNovel(states.get(novel.id), novel)) {
      coveredIds.add(novel.id);
    } else {
      candidateIds.add(novel.id);
    }
  }

  if (!coveredIds.size) {
    return null;
  }

  try {
    let matchedIds: Set<number> | null = null;
    const engines = new Set<"bigram" | "trigram">();
    for (const term of terms) {
      const result = queryCoveredIds(db, term);
      engines.add(result.engine);
      if (matchedIds === null) {
        matchedIds = result.ids;
      } else {
        const currentMatches: Set<number> = matchedIds;
        matchedIds = new Set<number>(Array.from(currentMatches).filter((id) => result.ids.has(id)));
      }
      if (!matchedIds.size) {
        break;
      }
    }

    for (const novelId of matchedIds || []) {
      if (coveredIds.has(novelId)) {
        candidateIds.add(novelId);
      }
    }

    return {
      engine: engines.size > 1 ? "fts5-hybrid" : engines.has("bigram") ? "fts5-bigram" : "fts5-trigram",
      terms,
      candidateIds: Array.from(candidateIds).sort((left, right) => left - right),
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
): ContentSearchIndexSummary {
  const mainDatabase = (mainDb.prepare("PRAGMA database_list").all() as Array<{ name: string; file: string }>)
    .find((item) => item.name === "main");
  if (mainDatabase?.file) {
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
         LEFT JOIN content_search_failures f ON f.novel_id = n.id`,
      ).get(
        CONTENT_SEARCH_INDEX_VERSION,
        CONTENT_SEARCH_INDEX_VERSION,
        CONTENT_SEARCH_INDEX_VERSION,
        CONTENT_SEARCH_INDEX_VERSION,
      ) as {
        total_books: number;
        source_bytes: number;
        indexed_books: number;
        stale_books: number;
        failed_books: number;
        last_indexed_at: string | null;
      };
      const databaseBytes = getContentSearchDiskUsageBytes();
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

  const novels = mainDb
    .prepare("SELECT id, relative_path, content_hash, size_bytes, mtime_ms FROM novels ORDER BY id ASC")
    .all() as ContentSearchNovelRecord[];
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
  const databaseBytes = getContentSearchDiskUsageBytes();
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

export function deleteContentSearchIndexNovel(db: DatabaseSync, novelId: number) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM content_trigram_fts WHERE rowid = ?").run(novelId);
    db.prepare("DELETE FROM content_bigram_fts WHERE rowid = ?").run(novelId);
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
    db.exec(`
      INSERT INTO content_trigram_fts(content_trigram_fts) VALUES('delete-all');
      INSERT INTO content_bigram_fts(content_bigram_fts) VALUES('delete-all');
      DELETE FROM content_search_state;
      DELETE FROM content_search_failures;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function optimizeContentSearchIndex(db: DatabaseSync) {
  db.prepare("INSERT INTO content_trigram_fts(content_trigram_fts) VALUES('optimize')").run();
  db.prepare("INSERT INTO content_bigram_fts(content_bigram_fts) VALUES('optimize')").run();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
}

export async function buildContentSearchIndex(
  mainDb: DatabaseSync,
  searchDb: DatabaseSync,
  onProgress?: (progress: ContentSearchIndexProgress) => void,
  options: ContentSearchIndexBuildOptions = {},
): Promise<ContentSearchIndexResult> {
  const novels = mainDb
    .prepare("SELECT id, relative_path, content_hash, size_bytes, mtime_ms FROM novels ORDER BY id ASC")
    .all() as ContentSearchNovelRecord[];
  const sourceBytes = novels.reduce((total, novel) => total + novel.size_bytes, 0);
  if (options.force) {
    clearContentSearchIndex(searchDb);
  }

  const stateRows = listStates(searchDb);
  const states = new Map(stateRows.map((state) => [state.novelId, state]));
  const currentIds = new Set(novels.map((novel) => novel.id));
  const obsoleteIds = new Set([
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
  const deleteTrigram = searchDb.prepare("DELETE FROM content_trigram_fts WHERE rowid = ?");
  const deleteBigram = searchDb.prepare("DELETE FROM content_bigram_fts WHERE rowid = ?");
  const deleteState = searchDb.prepare("DELETE FROM content_search_state WHERE novel_id = ?");
  const deleteFailure = searchDb.prepare("DELETE FROM content_search_failures WHERE novel_id = ?");
  const insertTrigram = searchDb.prepare("INSERT INTO content_trigram_fts(rowid, body) VALUES (?, ?)");
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
        deleteTrigram.run(item.novel.id);
        deleteBigram.run(item.novel.id);
        insertTrigram.run(item.novel.id, item.normalizedContent);
        insertBigram.run(item.novel.id, item.bigramTokens);
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
      const normalizedContent = normalizeSearchText(await readNovelContent(novel));
      prepared.push({ novel, normalizedContent, bigramTokens: createBigramTokenDocument(normalizedContent) });
      preparedChars += normalizedContent.length;
    } catch (error) {
      searchDb.exec("BEGIN");
      try {
        deleteTrigram.run(novel.id);
        deleteBigram.run(novel.id);
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
  const databaseBytes = getContentSearchDiskUsageBytes();
  if (
    sourceBytes >= CONTENT_SEARCH_RATIO_MIN_SOURCE_BYTES &&
    databaseBytes > sourceBytes * CONTENT_SEARCH_MAX_SOURCE_RATIO
  ) {
    throw new Error(`全文索引大小已超过原文的 ${CONTENT_SEARCH_MAX_SOURCE_RATIO} 倍，请停止使用并检查索引配置`);
  }
  emitProgress();
  return { totalBooks: novels.length, processedBooks, indexedBooks, reusedBooks, failedBooks, sourceBytes, databaseBytes };
}
