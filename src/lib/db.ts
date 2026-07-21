import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getContentSearchDatabasePath, getDatabasePath } from "./config";

type DbGlobal = typeof globalThis & {
  novelReaderDb?: DatabaseSync;
};

const LEGACY_SEARCH_TABLES = [
  "novel_segments_fts",
  "novel_segments",
  "content_index_staging_terms",
  "content_index_jobs",
  "content_index_novel_state",
  "content_search_terms",
  "content_search_term_stats",
  "search_index_state",
] as const;

function cleanupLegacySearchTables(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    for (const tableName of LEGACY_SEARCH_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${tableName};`);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function cleanupLegacyContentIndexFiles(databasePath: string) {
  const legacyPath = path.join(path.dirname(databasePath), "content-index.db");
  const protectedPaths = new Set([databasePath, getContentSearchDatabasePath()].map((filePath) => path.resolve(filePath)));
  if (protectedPaths.has(path.resolve(legacyPath))) {
    return;
  }
  for (const filePath of [legacyPath, `${legacyPath}-wal`, `${legacyPath}-shm`]) {
    fs.rmSync(filePath, { force: true });
  }
}

function migrateNovelsAllowDuplicateTitles(db: DatabaseSync) {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'novels'")
    .get() as { sql?: string } | undefined;

  if (!table?.sql || !/title\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i.test(table.sql)) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
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
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

function dropColumnIfPresent(db: DatabaseSync, tableName: string, columnName: string) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} DROP COLUMN ${columnName}`);
  }
}

function cleanupObsoleteHistoryColumns(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    dropColumnIfPresent(db, "users", "history_visible");
    dropColumnIfPresent(db, "user_reading_history", "hidden_by_user");
    dropColumnIfPresent(db, "user_media_history", "hidden_by_user");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateLegacySearchRateLimitBans(db: DatabaseSync) {
  const legacy = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'search_rate_limit_bans'")
    .get() as { found: number } | undefined;
  if (!legacy) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      INSERT OR IGNORE INTO rate_limit_bans (category, ip, rule_id, is_permanent, banned_until, created_at, updated_at)
      SELECT 'search', ip, rule_id, is_permanent, banned_until, created_at, updated_at
      FROM search_rate_limit_bans;
      DROP TABLE search_rate_limit_bans;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function initialize(db: DatabaseSync) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  cleanupLegacySearchTables(db);
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
      last_accessed_ip TEXT,
      last_accessed_user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_novels_title ON novels(title);

    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      aliases TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tags_visible_sort ON tags(is_visible, sort_order, name);

    CREATE TABLE IF NOT EXISTS novel_tags (
      novel_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(novel_id, tag_id),
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novel_tags_tag ON novel_tags(tag_id, novel_id);

    CREATE TABLE IF NOT EXISTS novel_hotwords (
      novel_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(novel_id, term),
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novel_hotwords_novel_sort ON novel_hotwords(novel_id, sort_order, term);

    CREATE TABLE IF NOT EXISTS pinned_novels (
      novel_id INTEGER PRIMARY KEY,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pinned_novels_sort ON pinned_novels(sort_order, novel_id);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
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

    CREATE TABLE IF NOT EXISTS user_login_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_login_records_user_time ON user_login_records(user_id, logged_at);
    CREATE INDEX IF NOT EXISTS idx_user_login_records_time ON user_login_records(logged_at);

    CREATE TABLE IF NOT EXISTS admin_login_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      ip TEXT NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      logged_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_admin_login_records_time ON admin_login_records(logged_at);

    CREATE TABLE IF NOT EXISTS analytics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      event_type TEXT NOT NULL,
      path TEXT NOT NULL,
      referrer TEXT,
      ip TEXT NOT NULL,
      country TEXT,
      user_agent TEXT NOT NULL DEFAULT '',
      device TEXT NOT NULL DEFAULT 'unknown',
      browser TEXT NOT NULL DEFAULT 'unknown',
      os TEXT NOT NULL DEFAULT 'unknown',
      novel_id INTEGER,
      media_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE SET NULL,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_analytics_events_time ON analytics_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_type_time ON analytics_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_ip_time ON analytics_events(ip, created_at);
    CREATE INDEX IF NOT EXISTS idx_analytics_events_path_time ON analytics_events(path, created_at);

    CREATE TABLE IF NOT EXISTS search_query_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT UNIQUE,
      query TEXT NOT NULL,
      mode TEXT NOT NULL CHECK(mode IN ('title', 'content')),
      source TEXT NOT NULL DEFAULT 'direct',
      user_id INTEGER,
      origin_novel_id INTEGER,
      result_count INTEGER,
      result_novel_count INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(origin_novel_id) REFERENCES novels(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_search_query_events_time ON search_query_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_search_query_events_query_time ON search_query_events(query, created_at);

    CREATE TABLE IF NOT EXISTS search_query_terms (
      search_event_id INTEGER NOT NULL,
      term TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(search_event_id, position),
      FOREIGN KEY(search_event_id) REFERENCES search_query_events(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_search_query_terms_term_event ON search_query_terms(term, search_event_id);

    CREATE TABLE IF NOT EXISTS search_result_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      search_event_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      segment_index INTEGER,
      clicked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(search_event_id) REFERENCES search_query_events(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_search_result_clicks_event_time ON search_result_clicks(search_event_id, clicked_at);
    CREATE INDEX IF NOT EXISTS idx_search_result_clicks_novel_time ON search_result_clicks(novel_id, clicked_at);

    CREATE TABLE IF NOT EXISTS content_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('tag_error', 'hotword_error', 'spam', 'other')),
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_content_reports_status_time ON content_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_reports_user_time ON content_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_reports_novel_time ON content_reports(novel_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limit_bans (
      category TEXT NOT NULL,
      ip TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      banned_until INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(category, ip)
    );

    CREATE INDEX IF NOT EXISTS idx_rate_limit_bans_category_until ON rate_limit_bans(category, banned_until);

    CREATE TABLE IF NOT EXISTS video_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('video', 'audio', 'file')),
      category_id INTEGER REFERENCES video_categories(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL,
      play_count INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_media_assets_kind_created ON media_assets(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_assets_title ON media_assets(title);
    CREATE TABLE IF NOT EXISTS user_media_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('video', 'audio', 'file')),
      title TEXT NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, media_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_media_history_user_time ON user_media_history(user_id, last_accessed_at);
    CREATE INDEX IF NOT EXISTS idx_user_media_history_media ON user_media_history(media_id);

  `);
  migrateLegacySearchRateLimitBans(db);
  migrateNovelsContentHash(db);
  addColumnIfMissing(db, "novels", "word_count", "word_count INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "novels", "visit_count", "visit_count INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "novels", "last_accessed_at", "last_accessed_at TEXT");
  addColumnIfMissing(db, "novels", "last_accessed_ip", "last_accessed_ip TEXT");
  addColumnIfMissing(db, "novels", "last_accessed_user_agent", "last_accessed_user_agent TEXT");
  addColumnIfMissing(db, "users", "registration_ip", "registration_ip TEXT");
  addColumnIfMissing(db, "users", "role", "role TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing(db, "media_assets", "artist", "artist TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "media_assets", "mtime_ms", "mtime_ms INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "media_assets", "duration_seconds", "duration_seconds REAL");
  addColumnIfMissing(db, "media_assets", "category_id", "category_id INTEGER REFERENCES video_categories(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "tags", "parent_id", "parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "tags", "aliases", "aliases TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, "analytics_events", "media_id", "media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "search_query_events", "event_key", "event_key TEXT");
  addColumnIfMissing(db, "search_query_events", "source", "source TEXT NOT NULL DEFAULT 'direct'");
  addColumnIfMissing(db, "search_query_events", "user_id", "user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "search_query_events", "origin_novel_id", "origin_novel_id INTEGER REFERENCES novels(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "search_query_events", "result_count", "result_count INTEGER");
  addColumnIfMissing(db, "search_query_events", "result_novel_count", "result_novel_count INTEGER");
  cleanupObsoleteHistoryColumns(db);
  db.exec("DROP INDEX IF EXISTS idx_novel_tags_tag_novel;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_title_hash ON novels(title, content_hash);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_last_accessed ON novels(last_accessed_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_last_accessed_ip ON novels(last_accessed_ip);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_registration_ip_created ON users(registration_ip, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_analytics_events_media_time ON analytics_events(media_id, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_video_category ON media_assets(kind, category_id, updated_at DESC);");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_search_query_events_event_key ON search_query_events(event_key) WHERE event_key IS NOT NULL;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_search_query_events_source_time ON search_query_events(source, created_at);");
}

export function getDb(): DatabaseSync {
  const globalForDb = globalThis as DbGlobal;
  if (globalForDb.novelReaderDb) {
    return globalForDb.novelReaderDb;
  }

  const databasePath = getDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  cleanupLegacyContentIndexFiles(databasePath);

  const db = new DatabaseSync(databasePath);
  initialize(db);
  globalForDb.novelReaderDb = db;
  return db;
}
