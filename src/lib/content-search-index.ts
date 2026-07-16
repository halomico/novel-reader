import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { readNovelContent, type Novel } from "./books";
import { getContentSearchDatabasePath } from "./config";
import { normalizeSearchText } from "./search-query";

export const CONTENT_SEARCH_INDEX_VERSION = 1;
export const CONTENT_SEARCH_MAX_SOURCE_RATIO = 5;
const CONTENT_SEARCH_RATIO_MIN_SOURCE_BYTES = 10 * 1024 * 1024;

type ContentSearchStateRow = {
  novelId: number;
  contentHash: string | null;
  sizeBytes: number;
  mtimeMs: number;
  indexVersion: number;
};

export type ContentSearchCandidatePlan = {
  engine: "fts5-bigram" | "fts5-trigram";
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

export type ContentSearchIndexBuildOptions = {
  force?: boolean;
  optimize?: boolean;
  isCancelled?: () => boolean;
};

type PreparedNovelIndex = {
  novel: Novel;
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
              mtime_ms AS mtimeMs, index_version AS indexVersion
       FROM content_search_state`,
    )
    .all() as ContentSearchStateRow[];
}

function stateMatchesNovel(state: ContentSearchStateRow | undefined, novel: Novel): boolean {
  return Boolean(
    state &&
      state.indexVersion === CONTENT_SEARCH_INDEX_VERSION &&
      state.contentHash === novel.content_hash &&
      state.sizeBytes === novel.size_bytes &&
      state.mtimeMs === novel.mtime_ms,
  );
}

export function findContentSearchCandidateNovelIds(
  db: DatabaseSync,
  novels: Novel[],
  anchorTerm: string,
): ContentSearchCandidatePlan | null {
  const normalizedTerm = normalizeSearchText(anchorTerm);
  const termChars = Array.from(normalizedTerm);
  if (termChars.length < 2 || !novels.length) {
    return null;
  }

  const states = new Map(listStates(db).map((state) => [state.novelId, state]));
  const coveredIds = new Set<number>();
  const candidateIds = new Set<number>();
  const currentNovelIds = new Set(novels.map((novel) => novel.id));
  for (const novel of novels) {
    if (stateMatchesNovel(states.get(novel.id), novel)) {
      coveredIds.add(novel.id);
    } else {
      candidateIds.add(novel.id);
    }
  }

  if (!coveredIds.size) {
    return null;
  }

  try {
    const rows =
      termChars.length === 2
        ? (db
            .prepare("SELECT rowid AS novelId FROM content_bigram_fts WHERE content_bigram_fts MATCH ? ORDER BY rowid")
            .all(createBigramToken(termChars[0], termChars[1])) as Array<{ novelId: number }>)
        : (db
            .prepare("SELECT rowid AS novelId FROM content_trigram_fts WHERE content_trigram_fts MATCH ? ORDER BY rowid")
            .all(buildTrigramMatchQuery(normalizedTerm)) as Array<{ novelId: number }>);

    for (const row of rows) {
      if (coveredIds.has(row.novelId) && currentNovelIds.has(row.novelId)) {
        candidateIds.add(row.novelId);
      }
    }

    return {
      engine: termChars.length === 2 ? "fts5-bigram" : "fts5-trigram",
      candidateIds: Array.from(candidateIds).sort((left, right) => left - right),
      coveredNovelCount: coveredIds.size,
      uncoveredNovelCount: novels.length - coveredIds.size,
    };
  } catch {
    return null;
  }
}

export function deleteContentSearchIndexNovel(db: DatabaseSync, novelId: number) {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM content_trigram_fts WHERE rowid = ?").run(novelId);
    db.prepare("DELETE FROM content_bigram_fts WHERE rowid = ?").run(novelId);
    db.prepare("DELETE FROM content_search_state WHERE novel_id = ?").run(novelId);
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
    .prepare(
      `SELECT id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count,
              visit_count, last_accessed_at, last_accessed_ip, last_accessed_user_agent, created_at, updated_at
       FROM novels
       ORDER BY id ASC`,
    )
    .all() as Novel[];
  const sourceBytes = novels.reduce((total, novel) => total + novel.size_bytes, 0);
  if (options.force) {
    clearContentSearchIndex(searchDb);
  }

  const stateRows = listStates(searchDb);
  const states = new Map(stateRows.map((state) => [state.novelId, state]));
  const currentIds = new Set(novels.map((novel) => novel.id));
  for (const state of stateRows) {
    if (!currentIds.has(state.novelId)) {
      deleteContentSearchIndexNovel(searchDb, state.novelId);
    }
  }

  let processedBooks = 0;
  let indexedBooks = 0;
  let reusedBooks = 0;
  let failedBooks = 0;
  let preparedChars = 0;
  const prepared: PreparedNovelIndex[] = [];
  const deleteTrigram = searchDb.prepare("DELETE FROM content_trigram_fts WHERE rowid = ?");
  const deleteBigram = searchDb.prepare("DELETE FROM content_bigram_fts WHERE rowid = ?");
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
    if (!options.force && stateMatchesNovel(states.get(novel.id), novel)) {
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
    } catch {
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
