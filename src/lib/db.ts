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

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
  }
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
      word_count INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
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

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      search_rate_limit_per_minute INTEGER,
      registration_ip TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      last_login_ip TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);

    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT,
      last_ip TEXT,
      user_agent TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS user_reading_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      segment_index INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, novel_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_history_user_time ON user_reading_history(user_id, last_read_at);
    CREATE INDEX IF NOT EXISTS idx_user_history_novel ON user_reading_history(novel_id);

  `);
  migrateNovelsContentHash(db);
  addColumnIfMissing(db, "novels", "word_count", "word_count INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "novels", "visit_count", "visit_count INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "novels", "last_accessed_at", "last_accessed_at TEXT");
  addColumnIfMissing(db, "users", "registration_ip", "registration_ip TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_title_hash ON novels(title, content_hash);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_last_accessed ON novels(last_accessed_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_registration_ip_created ON users(registration_ip, created_at);");
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
