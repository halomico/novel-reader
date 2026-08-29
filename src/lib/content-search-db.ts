import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getContentSearchIndexDirectory } from "./config";

type ContentSearchDbGlobal = typeof globalThis & {
  novelReaderContentSearchDbs?: Map<number, DatabaseSync>;
};

function normalizeSourceId(sourceId: number): number {
  if (!Number.isInteger(sourceId) || sourceId < 1) {
    throw new Error("小说书库不存在");
  }
  return sourceId;
}

function getContentSearchDbMap(): Map<number, DatabaseSync> {
  const globalForDb = globalThis as ContentSearchDbGlobal;
  if (!globalForDb.novelReaderContentSearchDbs) {
    globalForDb.novelReaderContentSearchDbs = new Map();
  }
  return globalForDb.novelReaderContentSearchDbs;
}

export function getContentSearchDatabasePathForSource(sourceId: number): string {
  return path.join(getContentSearchIndexDirectory(), `source-${normalizeSourceId(sourceId)}.db`);
}

export function getContentSearchDatabaseRelatedPaths(sourceId: number): string[] {
  const databasePath = getContentSearchDatabasePathForSource(sourceId);
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
}

export function getContentSearchDatabaseDiskUsage(sourceId: number): number {
  return getContentSearchDatabaseRelatedPaths(sourceId).reduce((total, filePath) => {
    try {
      return total + fs.statSync(filePath).size;
    } catch {
      return total;
    }
  }, 0);
}

export function initializeContentSearchDb(db: DatabaseSync) {
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_search_state (
      novel_id INTEGER PRIMARY KEY,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      index_version INTEGER NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_content_search_state_version
      ON content_search_state(index_version, novel_id);

    CREATE TABLE IF NOT EXISTS content_search_failures (
      novel_id INTEGER PRIMARY KEY,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      index_version INTEGER NOT NULL,
      error TEXT NOT NULL,
      attempted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_content_search_failures_attempted
      ON content_search_failures(attempted_at DESC, novel_id);

    CREATE TABLE IF NOT EXISTS content_search_segments (
      id INTEGER PRIMARY KEY,
      novel_id INTEGER NOT NULL,
      chapter_id INTEGER,
      chapter_title TEXT,
      segment_index INTEGER NOT NULL,
      body BLOB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_content_search_segments_novel
      ON content_search_segments(novel_id, segment_index);

    CREATE VIRTUAL TABLE IF NOT EXISTS content_bigram_fts USING fts5(
      tokens,
      content='',
      contentless_delete=1,
      detail=none,
      tokenize='unicode61 remove_diacritics 0'
    );
  `);
}

export function getContentSearchDb(sourceId: number): DatabaseSync {
  const normalizedSourceId = normalizeSourceId(sourceId);
  const databases = getContentSearchDbMap();
  const existing = databases.get(normalizedSourceId);
  if (existing) {
    return existing;
  }

  const databasePath = getContentSearchDatabasePathForSource(normalizedSourceId);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  initializeContentSearchDb(db);
  databases.set(normalizedSourceId, db);
  return db;
}

export function getExistingContentSearchDb(sourceId: number): DatabaseSync | null {
  const normalizedSourceId = normalizeSourceId(sourceId);
  const databases = getContentSearchDbMap();
  const existing = databases.get(normalizedSourceId);
  if (existing) return existing;
  if (!fs.existsSync(getContentSearchDatabasePathForSource(normalizedSourceId))) return null;
  return getContentSearchDb(normalizedSourceId);
}

export function closeContentSearchDb(sourceId: number) {
  const normalizedSourceId = normalizeSourceId(sourceId);
  const databases = getContentSearchDbMap();
  databases.get(normalizedSourceId)?.close();
  databases.delete(normalizedSourceId);
}

export function deleteContentSearchDatabase(sourceId: number) {
  const normalizedSourceId = normalizeSourceId(sourceId);
  closeContentSearchDb(normalizedSourceId);
  for (const filePath of getContentSearchDatabaseRelatedPaths(normalizedSourceId)) {
    fs.rmSync(filePath, { force: true });
  }
}

export function closeAllContentSearchDbs() {
  const databases = getContentSearchDbMap();
  for (const database of databases.values()) database.close();
  databases.clear();
}
