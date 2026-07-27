import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getContentSearchDatabasePath, getDatabasePath } from "./config";
import { naturalSortKey } from "./natural-sort";

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

function migrateTagVisibility(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(tags)").all() as Array<{ name: string }>;
  const hasLegacyVisibility = columns.some((column) => column.name === "is_visible");
  if (!columns.some((column) => column.name === "visibility")) {
    db.exec("ALTER TABLE tags ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'member', 'hidden'));");
  }
  if (!hasLegacyVisibility) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      UPDATE tags
      SET visibility = CASE WHEN is_visible = 1 THEN 'public' ELSE 'hidden' END;
      DROP INDEX IF EXISTS idx_tags_visible_sort;
      ALTER TABLE tags DROP COLUMN is_visible;
    `);
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
    db.exec("DROP TABLE search_rate_limit_bans;");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateLegacyContentAccessBans(db: DatabaseSync) {
  const legacy = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit_bans'")
    .get() as { found: number } | undefined;
  if (!legacy) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      INSERT INTO content_access_rules (
        target_type, target_value, scope, audience, source, reason, expires_at
      )
      SELECT
        'ip',
        ip,
        'all',
        'all',
        'rate_limit',
        '由旧版正文访问规则迁移',
        CASE
          WHEN is_permanent = 1 THEN (CAST(strftime('%s', 'now') AS INTEGER) * 1000) + 86400000
          ELSE banned_until
        END
      FROM rate_limit_bans
      WHERE category = 'content'
        AND (is_permanent = 1 OR banned_until > CAST(strftime('%s', 'now') AS INTEGER) * 1000);

      DROP TABLE rate_limit_bans;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateContentReports(db: DatabaseSync) {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_reports'")
    .get() as { sql?: string } | undefined;
  if (
    !table?.sql ||
    (table.sql.includes("media_id") && table.sql.includes("'playback_error'"))
  ) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE content_reports_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        novel_id INTEGER,
        media_id INTEGER,
        category TEXT NOT NULL CHECK(category IN ('title_error', 'tag_error', 'hotword_error', 'playback_error', 'spam', 'other')),
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
        resolved_by TEXT,
        resolved_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(
          (novel_id IS NOT NULL AND media_id IS NULL) OR
          (novel_id IS NULL AND media_id IS NOT NULL)
        ),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
        FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
      );

      INSERT INTO content_reports_new (
        id, user_id, novel_id, media_id, category, details, status,
        resolved_by, resolved_at, created_at, updated_at
      )
      SELECT
        id, user_id, novel_id, NULL, category, details, status,
        resolved_by, resolved_at, created_at, updated_at
      FROM content_reports;

      DROP TABLE content_reports;
      ALTER TABLE content_reports_new RENAME TO content_reports;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateContentAccessCrawlerTarget(db: DatabaseSync) {
  const table = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_access_rules'")
    .get() as { sql?: string } | undefined;
  if (!table?.sql || /target_type\s+IN\s*\([^)]*'crawler'/i.test(table.sql)) {
    return;
  }
  db.exec("BEGIN");
  try {
    db.exec(`
      CREATE TABLE content_access_rules_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('ip', 'cidr', 'country', 'crawler')),
        target_value TEXT NOT NULL,
        match_mode TEXT NOT NULL DEFAULT 'include' CHECK(match_mode IN ('include', 'exclude')),
        scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'media')),
        audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all', 'guest')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'rate_limit')),
        reason TEXT NOT NULL DEFAULT '',
        expires_at INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO content_access_rules_new (
        id, target_type, target_value, scope, audience, source, reason,
        expires_at, enabled, created_by, created_at, updated_at
      )
      SELECT id, target_type, target_value, scope, audience, source, reason,
             expires_at, enabled, created_by, created_at, updated_at
      FROM content_access_rules;

      DROP TABLE content_access_rules;
      ALTER TABLE content_access_rules_new RENAME TO content_access_rules;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateContentAccessMatchMode(db: DatabaseSync) {
  addColumnIfMissing(
    db,
    "content_access_rules",
    "match_mode",
    "match_mode TEXT NOT NULL DEFAULT 'include' CHECK(match_mode IN ('include', 'exclude'))",
  );
}

function migrateUserEconomy(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const needsTrustLevel = !columns.some((column) => column.name === "trust_level");
  if (needsTrustLevel) {
    db.exec("ALTER TABLE users ADD COLUMN trust_level INTEGER NOT NULL DEFAULT 0 CHECK(trust_level BETWEEN 0 AND 6);");
    db.exec("UPDATE users SET trust_level = 2;");
  }
  if (!columns.some((column) => column.name === "soda_balance")) {
    if (columns.some((column) => column.name === "cola_balance")) {
      db.exec("ALTER TABLE users RENAME COLUMN cola_balance TO soda_balance;");
    } else {
      db.exec("ALTER TABLE users ADD COLUMN soda_balance INTEGER NOT NULL DEFAULT 0 CHECK(soda_balance >= 0);");
    }
  }
  if (!columns.some((column) => column.name === "soda_experience")) {
    db.exec("ALTER TABLE users ADD COLUMN soda_experience INTEGER NOT NULL DEFAULT 0 CHECK(soda_experience >= 0);");
  }
  addColumnIfMissing(db, "user_levels", "soda_required", "soda_required INTEGER NOT NULL DEFAULT 0 CHECK(soda_required >= 0)");

  const levelMigrationKey = "user_level_schema_v3";
  const levelMigrated = db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(levelMigrationKey);
  if (!levelMigrated) {
    db.exec("BEGIN");
    try {
      db.exec(`
        UPDATE users
        SET trust_level = MIN(COALESCE(trust_level, 0) + 1, 6);

        UPDATE users
        SET soda_experience = MAX(
          soda_balance,
          CASE trust_level
            WHEN 2 THEN 50
            WHEN 3 THEN 200
            WHEN 4 THEN 500
            WHEN 5 THEN 1200
            WHEN 6 THEN 2500
            ELSE 0
          END
        );

        DELETE FROM user_levels;
      `);
      db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(levelMigrationKey);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  const legacyTransactions = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'user_cola_transactions'")
    .get();
  if (legacyTransactions) {
    db.exec(`
      INSERT OR IGNORE INTO user_soda_transactions (
        id, user_id, amount, balance_after, source, note, created_at
      )
      SELECT id, user_id, amount, balance_after, source, note, created_at
      FROM user_cola_transactions;
      DROP TABLE user_cola_transactions;
    `);
  }
}

function migrateNovelRecommendations(db: DatabaseSync) {
  const novelColumns = db.prepare("PRAGMA table_info(novels)").all() as Array<{ name: string }>;
  const addedRecommendCount = !novelColumns.some((column) => column.name === "recommend_count");
  if (addedRecommendCount) {
    db.exec("ALTER TABLE novels ADD COLUMN recommend_count INTEGER NOT NULL DEFAULT 0 CHECK(recommend_count >= 0);");
  }

  let recommendationColumns = db.prepare("PRAGMA table_info(novel_recommendations)").all() as Array<{ name: string }>;
  const hasDailyKey = recommendationColumns.some((column) => column.name === "recommendation_date");
  if (hasDailyKey) {
    const spentColumn = recommendationColumns.some((column) => column.name === "soda_spent")
      ? "soda_spent"
      : recommendationColumns.some((column) => column.name === "cola_spent")
        ? "cola_spent"
        : "0";
    db.exec("BEGIN");
    try {
      db.exec(`
        DROP TRIGGER IF EXISTS novel_recommendations_insert_count;

        CREATE TABLE novel_recommendations_new (
          novel_id INTEGER NOT NULL,
          user_id INTEGER NOT NULL,
          soda_spent INTEGER NOT NULL DEFAULT 0 CHECK(soda_spent >= 0),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(novel_id, user_id),
          FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
          FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO novel_recommendations_new (
          novel_id, user_id, soda_spent, created_at
        )
        SELECT novel_id, user_id, MAX(${spentColumn}), MIN(created_at)
        FROM novel_recommendations
        GROUP BY novel_id, user_id;

        DROP TABLE novel_recommendations;
        ALTER TABLE novel_recommendations_new RENAME TO novel_recommendations;
      `);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    recommendationColumns = db.prepare("PRAGMA table_info(novel_recommendations)").all() as Array<{ name: string }>;
  }
  if (!recommendationColumns.some((column) => column.name === "soda_spent")) {
    if (recommendationColumns.some((column) => column.name === "cola_spent")) {
      db.exec("ALTER TABLE novel_recommendations RENAME COLUMN cola_spent TO soda_spent;");
    } else {
      db.exec("ALTER TABLE novel_recommendations ADD COLUMN soda_spent INTEGER NOT NULL DEFAULT 0 CHECK(soda_spent >= 0);");
    }
  }

  if (addedRecommendCount || hasDailyKey) {
    db.exec(`
      UPDATE novels
      SET recommend_count = (
            SELECT COUNT(*) FROM novel_recommendations r
            WHERE r.novel_id = novels.id
          );
    `);
  }

  db.exec(`
    DROP TRIGGER IF EXISTS novel_recommendations_delete_count;

    CREATE INDEX IF NOT EXISTS idx_novel_recommendations_novel_time
      ON novel_recommendations(novel_id, created_at DESC);

    CREATE TRIGGER IF NOT EXISTS novel_recommendations_insert_count
    AFTER INSERT ON novel_recommendations
    BEGIN
      UPDATE novels
      SET recommend_count = recommend_count + 1
      WHERE id = NEW.novel_id;
    END;
  `);
}

function migrateMediaRecommendations(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(media_recommendations)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "recommendation_date")) {
    return;
  }
  db.exec("BEGIN");
  try {
    db.exec(`
      DROP TRIGGER IF EXISTS media_recommendations_insert_count;

      CREATE TABLE media_recommendations_new (
        media_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        soda_spent INTEGER NOT NULL DEFAULT 1 CHECK(soda_spent > 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(media_id, user_id),
        FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT OR IGNORE INTO media_recommendations_new (
        media_id, user_id, soda_spent, created_at
      )
      SELECT media_id, user_id, MAX(soda_spent), MIN(created_at)
      FROM media_recommendations
      GROUP BY media_id, user_id;

      DROP TABLE media_recommendations;
      ALTER TABLE media_recommendations_new RENAME TO media_recommendations;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  db.exec(`
    UPDATE media_assets
    SET recommend_count = (
      SELECT COUNT(*) FROM media_recommendations r
      WHERE r.media_id = media_assets.id
    );
  `);
}

function seedUserLevels(db: DatabaseSync) {
  const defaults = [
    [0, "访客", 0, []],
    [1, "初见", 0, ["content_report", "station_message", "novel_feedback"]],
    [2, "熟客", 50, ["content_report", "station_message", "novel_feedback", "advanced_search"]],
    [3, "常驻", 200, ["content_report", "station_message", "novel_feedback", "advanced_search"]],
    [4, "活跃", 500, ["content_report", "station_message", "novel_feedback", "advanced_search"]],
    [5, "资深", 1200, ["content_report", "station_message", "novel_feedback", "advanced_search"]],
    [6, "核心", 2500, ["content_report", "station_message", "novel_feedback", "advanced_search"]],
  ] as const;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_levels (level, name, soda_required, permissions) VALUES (?, ?, ?, ?)",
  );
  for (const [level, name, sodaRequired, permissions] of defaults) {
    insert.run(level, name, sodaRequired, JSON.stringify(permissions));
  }

  const migrationKey = "user_level_defaults_v2";
  const migrated = db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(migrationKey);
  if (!migrated) {
    const levelZero = db.prepare("SELECT permissions FROM user_levels WHERE level = 0").get() as
      | { permissions: string }
      | undefined;
    if (levelZero?.permissions === JSON.stringify(["content_report", "station_message"])) {
      db.prepare("UPDATE user_levels SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE level = 0")
        .run(JSON.stringify(defaults[0][3]));
    }
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(migrationKey);
  }
}

function initialize(db: DatabaseSync) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  cleanupLegacySearchTables(db);
  migrateNovelsAllowDuplicateTitles(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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
      recommend_count INTEGER NOT NULL DEFAULT 0 CHECK(recommend_count >= 0),
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
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public', 'member', 'hidden')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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
      trust_level INTEGER NOT NULL DEFAULT 1 CHECK(trust_level BETWEEN 0 AND 6),
      soda_balance INTEGER NOT NULL DEFAULT 0 CHECK(soda_balance >= 0),
      soda_experience INTEGER NOT NULL DEFAULT 0 CHECK(soda_experience >= 0),
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
      tag_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE SET NULL,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE SET NULL,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE SET NULL
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
      novel_id INTEGER,
      media_id INTEGER,
      category TEXT NOT NULL CHECK(category IN ('title_error', 'tag_error', 'hotword_error', 'playback_error', 'spam', 'other')),
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(
        (novel_id IS NOT NULL AND media_id IS NULL) OR
        (novel_id IS NULL AND media_id IS NOT NULL)
      ),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_content_reports_status_time ON content_reports(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_reports_user_time ON content_reports(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_content_reports_novel_time ON content_reports(novel_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS novel_recommendations (
      novel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      soda_spent INTEGER NOT NULL DEFAULT 0 CHECK(soda_spent >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(novel_id, user_id),
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novel_recommendations_novel_time
      ON novel_recommendations(novel_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_levels (
      level INTEGER PRIMARY KEY CHECK(level BETWEEN 0 AND 6),
      name TEXT NOT NULL,
      soda_required INTEGER NOT NULL DEFAULT 0 CHECK(soda_required >= 0),
      permissions TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_checkins (
      user_id INTEGER NOT NULL,
      checkin_date TEXT NOT NULL,
      reward INTEGER NOT NULL CHECK(reward BETWEEN 1 AND 20),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, checkin_date),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_soda_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
      source TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_soda_transactions_user_time
      ON user_soda_transactions(user_id, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS user_novel_favorites (
      user_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, novel_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_novel_favorites_user_time
      ON user_novel_favorites(user_id, created_at DESC, novel_id DESC);

    CREATE TABLE IF NOT EXISTS user_hidden_tags (
      user_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, tag_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_hidden_tags_user
      ON user_hidden_tags(user_id, tag_id);

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      audience TEXT NOT NULL DEFAULT 'public' CHECK(audience IN ('public', 'member')),
      importance TEXT NOT NULL DEFAULT 'normal' CHECK(importance IN ('normal', 'important')),
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
      published_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_announcements_visible
      ON announcements(status, audience, importance, published_at, expires_at);

    CREATE TABLE IF NOT EXISTS announcement_reads (
      announcement_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(announcement_id, user_id),
      FOREIGN KEY(announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS station_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
      user_last_read_message_id INTEGER NOT NULL DEFAULT 0,
      admin_last_read_message_id INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_station_threads_user_time
      ON station_threads(user_id, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_station_threads_status_time
      ON station_threads(status, last_message_at DESC);

    CREATE TABLE IF NOT EXISTS station_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      author_role TEXT NOT NULL CHECK(author_role IN ('user', 'admin')),
      author_user_id INTEGER,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(thread_id) REFERENCES station_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(author_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_station_messages_thread
      ON station_messages(thread_id, id);

    CREATE TABLE IF NOT EXISTS content_access_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('ip', 'cidr', 'country', 'crawler')),
      target_value TEXT NOT NULL,
      match_mode TEXT NOT NULL DEFAULT 'include' CHECK(match_mode IN ('include', 'exclude')),
      scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'media')),
      audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all', 'guest')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'rate_limit')),
      reason TEXT NOT NULL DEFAULT '',
      expires_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS content_access_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'media')),
      audience TEXT NOT NULL DEFAULT 'guest' CHECK(audience IN ('all', 'guest')),
      window_seconds INTEGER NOT NULL,
      max_requests INTEGER NOT NULL,
      block_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_content_access_policies_enabled
      ON content_access_policies(enabled, scope, audience);

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
      storage_node_id TEXT,
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
      thumbnail_version INTEGER NOT NULL DEFAULT 0,
      custom_cover_key TEXT,
      play_count INTEGER NOT NULL DEFAULT 0,
      recommend_count INTEGER NOT NULL DEFAULT 0 CHECK(recommend_count >= 0),
      download_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_media_assets_kind_created ON media_assets(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_assets_title ON media_assets(title);
    CREATE TABLE IF NOT EXISTS media_prepare_jobs (
      media_id INTEGER PRIMARY KEY,
      source_version INTEGER NOT NULL,
      thumbnail_percent INTEGER NOT NULL DEFAULT 33,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      next_run_at INTEGER NOT NULL DEFAULT 0,
      locked_until INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_prepare_jobs_ready
      ON media_prepare_jobs(status, next_run_at, media_id);

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

    CREATE TABLE IF NOT EXISTS user_media_favorites (
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, media_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_media_favorites_user_time
      ON user_media_favorites(user_id, created_at DESC, media_id DESC);

    CREATE TABLE IF NOT EXISTS media_recommendations (
      media_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      soda_spent INTEGER NOT NULL DEFAULT 1 CHECK(soda_spent > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(media_id, user_id),
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_recommendations_user_time
      ON media_recommendations(user_id, created_at DESC);

  `);
  migrateLegacySearchRateLimitBans(db);
  migrateTagVisibility(db);
  migrateLegacyContentAccessBans(db);
  migrateContentReports(db);
  migrateContentAccessCrawlerTarget(db);
  migrateContentAccessMatchMode(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_content_access_rules_match
      ON content_access_rules(enabled, scope, audience, target_type, target_value);
    CREATE INDEX IF NOT EXISTS idx_content_access_rules_expiry
      ON content_access_rules(expires_at);
  `);
  migrateUserEconomy(db);
  migrateNovelRecommendations(db);
  seedUserLevels(db);
  migrateNovelsContentHash(db);
  addColumnIfMissing(db, "novels", "word_count", "word_count INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "novels", "visit_count", "visit_count INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "novels", "last_accessed_at", "last_accessed_at TEXT");
  addColumnIfMissing(db, "novels", "last_accessed_ip", "last_accessed_ip TEXT");
  addColumnIfMissing(db, "novels", "last_accessed_user_agent", "last_accessed_user_agent TEXT");
  addColumnIfMissing(db, "users", "registration_ip", "registration_ip TEXT");
  addColumnIfMissing(db, "users", "role", "role TEXT NOT NULL DEFAULT 'user'");
  addColumnIfMissing(db, "media_assets", "storage_node_id", "storage_node_id TEXT");
  addColumnIfMissing(db, "media_assets", "artist", "artist TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "media_assets", "mtime_ms", "mtime_ms INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "media_assets", "duration_seconds", "duration_seconds REAL");
  addColumnIfMissing(db, "media_assets", "thumbnail_version", "thumbnail_version INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "media_assets", "custom_cover_key", "custom_cover_key TEXT");
  addColumnIfMissing(db, "media_assets", "recommend_count", "recommend_count INTEGER NOT NULL DEFAULT 0 CHECK(recommend_count >= 0)");
  addColumnIfMissing(db, "media_assets", "category_id", "category_id INTEGER REFERENCES video_categories(id) ON DELETE SET NULL");
  migrateMediaRecommendations(db);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS media_recommendations_insert_count
    AFTER INSERT ON media_recommendations
    BEGIN
      UPDATE media_assets
      SET recommend_count = recommend_count + 1
      WHERE id = NEW.media_id;
    END;
  `);
  addColumnIfMissing(db, "tags", "parent_id", "parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "tags", "aliases", "aliases TEXT NOT NULL DEFAULT '[]'");
  addColumnIfMissing(db, "analytics_events", "media_id", "media_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "analytics_events", "tag_id", "tag_id INTEGER REFERENCES tags(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "search_query_events", "event_key", "event_key TEXT");
  addColumnIfMissing(db, "search_query_events", "source", "source TEXT NOT NULL DEFAULT 'direct'");
  addColumnIfMissing(db, "search_query_events", "user_id", "user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "search_query_events", "origin_novel_id", "origin_novel_id INTEGER REFERENCES novels(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "search_query_events", "result_count", "result_count INTEGER");
  addColumnIfMissing(db, "search_query_events", "result_novel_count", "result_novel_count INTEGER");
  cleanupObsoleteHistoryColumns(db);
  db.exec("DROP INDEX IF EXISTS idx_novel_tags_tag_novel;");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_title_nocase_id ON novels(title COLLATE NOCASE, id);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tags_visibility_sort ON tags(visibility, sort_order, name);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_title_hash ON novels(title, content_hash);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_last_accessed ON novels(last_accessed_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_novels_last_accessed_ip ON novels(last_accessed_ip);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_registration_ip_created ON users(registration_ip, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_role ON users(role, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_trust_level ON users(trust_level, status);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_content_reports_status_time ON content_reports(status, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_content_reports_user_time ON content_reports(user_id, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_content_reports_novel_time ON content_reports(novel_id, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_content_reports_media_time ON content_reports(media_id, created_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_analytics_events_media_time ON analytics_events(media_id, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_analytics_events_tag_time ON analytics_events(tag_id, created_at);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_video_category ON media_assets(kind, category_id, updated_at DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_storage_node ON media_assets(storage_node_id, stored_name);");
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
  db.function("natural_sort_key", { deterministic: true }, naturalSortKey);
  initialize(db);
  globalForDb.novelReaderDb = db;
  return db;
}
