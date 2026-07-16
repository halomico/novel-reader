import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getContentSearchDatabasePath } from "./config";

type ContentSearchDbGlobal = typeof globalThis & {
  novelReaderContentSearchDb?: DatabaseSync;
};

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

    CREATE VIRTUAL TABLE IF NOT EXISTS content_trigram_fts USING fts5(
      body,
      content='',
      contentless_delete=1,
      detail=none,
      tokenize='trigram'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS content_bigram_fts USING fts5(
      tokens,
      content='',
      contentless_delete=1,
      detail=none,
      tokenize='unicode61 remove_diacritics 0'
    );
  `);
}

export function getContentSearchDb(): DatabaseSync {
  const globalForDb = globalThis as ContentSearchDbGlobal;
  if (globalForDb.novelReaderContentSearchDb) {
    return globalForDb.novelReaderContentSearchDb;
  }

  const databasePath = getContentSearchDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  initializeContentSearchDb(db);
  globalForDb.novelReaderContentSearchDb = db;
  return db;
}
