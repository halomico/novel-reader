import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getContentIndexDatabasePath } from "./config";

type ContentIndexDbGlobal = typeof globalThis & {
  novelReaderContentIndexDb?: DatabaseSync;
};

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function initializeContentIndexDb(db: DatabaseSync) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_search_terms (
      term TEXT NOT NULL,
      novel_id INTEGER NOT NULL,
      PRIMARY KEY(term, novel_id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_content_search_terms_novel
      ON content_search_terms(novel_id);

    CREATE TABLE IF NOT EXISTS content_search_term_stats (
      term TEXT PRIMARY KEY,
      segment_count INTEGER NOT NULL DEFAULT 0,
      novel_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'indexed',
      source TEXT NOT NULL DEFAULT 'auto',
      hit_count INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_content_search_term_stats_source_cold
      ON content_search_term_stats(source, last_used_at, hit_count, updated_at);

    CREATE TABLE IF NOT EXISTS content_index_jobs (
      id TEXT PRIMARY KEY,
      terms TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL,
      total_books INTEGER NOT NULL DEFAULT 0,
      scanned_books INTEGER NOT NULL DEFAULT 0,
      matched_books INTEGER NOT NULL DEFAULT 0,
      segment_count INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      heartbeat_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_index_staging_terms (
      job_id TEXT NOT NULL,
      term TEXT NOT NULL,
      novel_id INTEGER NOT NULL,
      PRIMARY KEY(job_id, term, novel_id)
    ) WITHOUT ROWID;

    CREATE INDEX IF NOT EXISTS idx_content_index_staging_terms_job
      ON content_index_staging_terms(job_id);

    CREATE TABLE IF NOT EXISTS content_index_novel_state (
      novel_id INTEGER PRIMARY KEY,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumnIfMissing(db, "content_search_term_stats", "novel_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "content_search_term_stats", "source", "TEXT NOT NULL DEFAULT 'auto'");
  addColumnIfMissing(db, "content_search_term_stats", "hit_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "content_search_term_stats", "last_used_at", "TEXT");
  addColumnIfMissing(db, "content_search_term_stats", "error", "TEXT");
  addColumnIfMissing(db, "content_search_term_stats", "created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
  addColumnIfMissing(db, "content_search_term_stats", "updated_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP");
}

export function getContentIndexDb(): DatabaseSync {
  const globalForDb = globalThis as ContentIndexDbGlobal;
  if (globalForDb.novelReaderContentIndexDb) {
    return globalForDb.novelReaderContentIndexDb;
  }

  const databasePath = getContentIndexDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  initializeContentIndexDb(db);
  globalForDb.novelReaderContentIndexDb = db;
  return db;
}
