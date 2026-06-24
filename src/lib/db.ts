import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "./config";

type DbGlobal = typeof globalThis & {
  novelReaderDb?: DatabaseSync;
};

function migrateNovelsAllowDuplicateTitles(db: DatabaseSync) {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'novels'")
    .get() as { sql?: string } | undefined;

  if (!table?.sql || !/title\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(table.sql)) {
    return;
  }

  db.exec(`
    BEGIN;

    CREATE TABLE novels_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO novels_new (id, title, file_name, relative_path, content_hash, size_bytes, mtime_ms, created_at, updated_at)
    SELECT id, title, file_name, relative_path, NULL, size_bytes, mtime_ms, created_at, updated_at
    FROM novels;

    DROP TABLE novels;
    ALTER TABLE novels_new RENAME TO novels;

    COMMIT;
  `);
}

function migrateNovelsContentHash(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(novels)").all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === "content_hash")) {
    return;
  }

  db.exec("ALTER TABLE novels ADD COLUMN content_hash TEXT;");
}

function initialize(db: DatabaseSync) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrateNovelsAllowDuplicateTitles(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_novels_title ON novels(title);

    CREATE TABLE IF NOT EXISTS search_index_state (
      novel_id INTEGER PRIMARY KEY,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      segment_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

  `);
  migrateNovelsContentHash(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_title_hash ON novels(title, content_hash);");
}

export function getDb(): DatabaseSync {
  const globalForDb = globalThis as DbGlobal;
  if (globalForDb.novelReaderDb) {
    return globalForDb.novelReaderDb;
  }

  const databasePath = getDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  initialize(db);
  globalForDb.novelReaderDb = db;
  return db;
}
