import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getDatabasePath } from "./config";
import { naturalSortKey } from "./natural-sort";

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

function migrateNovelLibraryModel(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS novel_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  addColumnIfMissing(db, "novels", "description", "description TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "novels", "source_id", "source_id INTEGER REFERENCES novel_sources(id) ON DELETE SET NULL");
  addColumnIfMissing(
    db,
    "novels",
    "storage_mode",
    "storage_mode TEXT NOT NULL DEFAULT 'single' CHECK(storage_mode IN ('single', 'chapters'))",
  );
  addColumnIfMissing(db, "novels", "chapter_count", "chapter_count INTEGER NOT NULL DEFAULT 0 CHECK(chapter_count >= 0)");
  addColumnIfMissing(
    db,
    "novels",
    "access_mode",
    "access_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(access_mode IN ('inherit', 'soda'))",
  );
  addColumnIfMissing(db, "novels", "soda_price", "soda_price INTEGER NOT NULL DEFAULT 0 CHECK(soda_price >= 0)");
  addColumnIfMissing(
    db,
    "novels",
    "preview_chapter_count",
    "preview_chapter_count INTEGER NOT NULL DEFAULT 0 CHECK(preview_chapter_count >= 0)",
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS novel_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      title_override TEXT,
      relative_path TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      sort_override INTEGER,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0 CHECK(word_count >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(novel_id, sort_order),
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novel_sources_sort
      ON novel_sources(sort_order, name, id);
    CREATE INDEX IF NOT EXISTS idx_novels_source_title
      ON novels(source_id, title COLLATE NOCASE, id);
    CREATE INDEX IF NOT EXISTS idx_novels_source_mtime_id
      ON novels(source_id, mtime_ms DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_novel_chapters_novel_sort
      ON novel_chapters(novel_id, sort_order, id);
  `);
  addColumnIfMissing(db, "novel_chapters", "title_override", "title_override TEXT");
  addColumnIfMissing(db, "novel_chapters", "sort_override", "sort_override INTEGER");
  const defaultSource = db.prepare(
    `INSERT INTO novel_sources (slug, name, relative_path)
     VALUES ('default', '默认来源', '')
     ON CONFLICT(relative_path) DO UPDATE SET updated_at = novel_sources.updated_at
     RETURNING id`,
  ).get() as { id: number };
  db.prepare("UPDATE novels SET source_id = ? WHERE source_id IS NULL").run(defaultSource.id);
  db.exec(`
    UPDATE novels
    SET chapter_count = (
      SELECT COUNT(*) FROM novel_chapters c WHERE c.novel_id = novels.id
    )
    WHERE storage_mode = 'chapters';
  `);
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

function dropLegacyContentAccessBans(db: DatabaseSync) {
  const legacy = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit_bans'")
    .get() as { found: number } | undefined;
  if (legacy) db.exec("DROP TABLE rate_limit_bans;");
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

function migrateContentAccessSchema(db: DatabaseSync) {
  const ruleTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_access_rules'")
    .get() as { sql?: string } | undefined;
  const policyTable = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_access_policies'")
    .get() as { sql?: string } | undefined;
  const ruleSql = ruleTable?.sql || "";
  const policySql = policyTable?.sql || "";
  const currentRules = ruleSql.includes("country_mode") &&
    ruleSql.includes("'crawler'") &&
    ruleSql.includes("'video'") &&
    ruleSql.includes("'audio'") &&
    ruleSql.includes("'file'") &&
    !ruleSql.includes("'media'");
  const currentPolicies = policySql.includes("country_mode") &&
    policySql.includes("'video'") &&
    policySql.includes("'audio'") &&
    policySql.includes("'file'") &&
    !policySql.includes("'media'");
  if (currentRules && currentPolicies) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.exec(`
      DROP TABLE content_access_rules;
      DROP TABLE content_access_policies;

      CREATE TABLE content_access_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL CHECK(target_type IN ('ip', 'cidr', 'country', 'crawler')),
        target_value TEXT NOT NULL,
        match_mode TEXT NOT NULL DEFAULT 'include' CHECK(match_mode IN ('include', 'exclude')),
        scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'video', 'audio', 'file')),
        country_mode TEXT NOT NULL DEFAULT 'all' CHECK(country_mode IN ('all', 'cn', 'non_cn')),
        audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all', 'guest')),
        source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'rate_limit')),
        reason TEXT NOT NULL DEFAULT '',
        expires_at INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE content_access_policies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'video', 'audio', 'file')),
        country_mode TEXT NOT NULL DEFAULT 'all' CHECK(country_mode IN ('all', 'cn', 'non_cn')),
        audience TEXT NOT NULL DEFAULT 'guest' CHECK(audience IN ('all', 'guest')),
        window_seconds INTEGER NOT NULL,
        max_requests INTEGER NOT NULL,
        block_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

function migrateMarketplaceAndRegistration(db: DatabaseSync) {
  addColumnIfMissing(db, "users", "email", "email TEXT");
  addColumnIfMissing(db, "users", "email_verified_at", "email_verified_at TEXT");
  addColumnIfMissing(db, "users", "cookie_balance", "cookie_balance INTEGER NOT NULL DEFAULT 0 CHECK(cookie_balance >= 0)");
  addColumnIfMissing(
    db,
    "user_levels",
    "video_concurrency_limit",
    "video_concurrency_limit INTEGER NOT NULL DEFAULT 1 CHECK(video_concurrency_limit BETWEEN 0 AND 20)",
  );
  addColumnIfMissing(
    db,
    "user_levels",
    "daily_video_download_limit",
    "daily_video_download_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_video_download_limit BETWEEN 0 AND 1000)",
  );

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(email COLLATE NOCASE)
      WHERE email IS NOT NULL AND email <> '';

    CREATE TABLE IF NOT EXISTS user_currency_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('soda', 'cookie')),
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
      source TEXT NOT NULL,
      reference_key TEXT,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_currency_transactions_user_time
      ON user_currency_transactions(user_id, created_at DESC, id DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_currency_transactions_reference
      ON user_currency_transactions(reference_key)
      WHERE reference_key IS NOT NULL;

    CREATE TABLE IF NOT EXISTS market_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
      min_level INTEGER NOT NULL DEFAULT 1 CHECK(min_level BETWEEN 1 AND 6),
      price_cookie INTEGER CHECK(price_cookie IS NULL OR price_cookie >= 0),
      price_soda INTEGER CHECK(price_soda IS NULL OR price_soda >= 0),
      purchase_limit_per_user INTEGER NOT NULL DEFAULT 1 CHECK(purchase_limit_per_user >= 0),
      sort_order INTEGER NOT NULL DEFAULT 0,
      cover_key TEXT,
      cover_storage_node_id TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_market_products_visible
      ON market_products(status, sort_order, updated_at DESC);

    CREATE TABLE IF NOT EXISTS market_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      storage_node_id TEXT,
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes INTEGER NOT NULL CHECK(size_bytes > 0),
      mtime_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(storage_node_id, stored_name),
      FOREIGN KEY(product_id) REFERENCES market_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_market_assets_product
      ON market_assets(product_id, id);

    CREATE TABLE IF NOT EXISTS market_delivery_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('text', 'secret', 'file', 'entitlement')),
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      market_asset_id INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES market_products(id) ON DELETE CASCADE,
      FOREIGN KEY(market_asset_id) REFERENCES market_assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_market_delivery_items_product
      ON market_delivery_items(product_id, sort_order, id);

    CREATE TABLE IF NOT EXISTS market_secret_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      ciphertext TEXT NOT NULL,
      iv TEXT NOT NULL,
      auth_tag TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'delivered', 'disabled')),
      order_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT,
      FOREIGN KEY(product_id) REFERENCES market_products(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_market_secret_inventory_available
      ON market_secret_inventory(product_id, status, id);

    CREATE TABLE IF NOT EXISTS market_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      product_id INTEGER,
      product_title TEXT NOT NULL,
      currency TEXT NOT NULL CHECK(currency IN ('soda', 'cookie')),
      amount INTEGER NOT NULL CHECK(amount >= 0),
      status TEXT NOT NULL DEFAULT 'paid' CHECK(status IN ('paid', 'fulfilled', 'cancelled', 'refunded')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      fulfilled_at TEXT,
      admin_deleted_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(product_id) REFERENCES market_products(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_market_orders_user_time
      ON market_orders(user_id, created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_market_orders_status_time
      ON market_orders(status, created_at DESC, id DESC);

    CREATE TABLE IF NOT EXISTS market_order_deliveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('text', 'secret', 'file', 'entitlement')),
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      market_asset_id INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES market_orders(id) ON DELETE CASCADE,
      FOREIGN KEY(market_asset_id) REFERENCES market_assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_market_order_deliveries_order
      ON market_order_deliveries(order_id, sort_order, id);

    CREATE TABLE IF NOT EXISTS user_entitlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      rights TEXT NOT NULL DEFAULT '[]',
      source_order_id INTEGER,
      granted_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      UNIQUE(user_id, resource_type, resource_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(source_order_id) REFERENCES market_orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS redemption_code_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      reward_type TEXT NOT NULL CHECK(reward_type IN ('cookie', 'soda', 'product')),
      reward_amount INTEGER NOT NULL DEFAULT 0 CHECK(reward_amount >= 0),
      product_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES market_products(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS redemption_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      code_hint TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available', 'redeemed', 'disabled')),
      redeemed_by INTEGER,
      redeemed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(batch_id) REFERENCES redemption_code_batches(id) ON DELETE CASCADE,
      FOREIGN KEY(redeemed_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_redemption_codes_batch_status
      ON redemption_codes(batch_id, status, id);

    CREATE TABLE IF NOT EXISTS registration_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      code_hint TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT '',
      max_uses INTEGER NOT NULL DEFAULT 1 CHECK(max_uses > 0),
      used_count INTEGER NOT NULL DEFAULT 0 CHECK(used_count >= 0),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_user
      ON email_verification_tokens(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_expiry
      ON email_verification_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS video_playback_sessions (
      id TEXT PRIMARY KEY,
      viewer_key TEXT NOT NULL,
      user_id INTEGER,
      client_id TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      storage_node_id TEXT,
      reserved_kbps INTEGER NOT NULL DEFAULT 0 CHECK(reserved_kbps >= 0),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(viewer_key, client_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS media_playback_grants (
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      soda_spent INTEGER NOT NULL DEFAULT 0 CHECK(soda_spent >= 0),
      granted_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, media_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_playback_grants_expiry
      ON media_playback_grants(expires_at);

    CREATE TABLE IF NOT EXISTS media_download_grants (
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      soda_spent INTEGER NOT NULL DEFAULT 0 CHECK(soda_spent >= 0),
      granted_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, media_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_download_grants_expiry
      ON media_download_grants(expires_at);

    CREATE TABLE IF NOT EXISTS media_download_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_download_sessions_user_time
      ON media_download_sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_download_sessions_expiry
      ON media_download_sessions(expires_at);
  `);
  addColumnIfMissing(
    db,
    "market_products",
    "purchase_limit_per_user",
    "purchase_limit_per_user INTEGER NOT NULL DEFAULT 1 CHECK(purchase_limit_per_user >= 0)",
  );
  addColumnIfMissing(db, "market_products", "cover_key", "cover_key TEXT");
  addColumnIfMissing(db, "market_products", "cover_storage_node_id", "cover_storage_node_id TEXT");
  addColumnIfMissing(db, "market_products", "deleted_at", "deleted_at TEXT");
  addColumnIfMissing(db, "market_orders", "admin_deleted_at", "admin_deleted_at TEXT");
  const marketProductColumns = db.prepare("PRAGMA table_info(market_products)").all() as Array<{ name: string }>;
  if (marketProductColumns.some((column) => column.name === "summary")) {
    db.exec(`
      UPDATE market_products
      SET description = summary
      WHERE trim(description) = '' AND trim(summary) <> '';
    `);
    dropColumnIfPresent(db, "market_products", "summary");
  }

  const currencyMigrationKey = "currency_transactions_v1";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(currencyMigrationKey)) {
    db.exec("BEGIN");
    try {
      db.exec(`
        INSERT OR IGNORE INTO user_currency_transactions (
          user_id, currency, amount, balance_after, source, reference_key, note, created_at
        )
        SELECT user_id, 'soda', amount, balance_after, source, 'legacy-soda:' || id, note, created_at
        FROM user_soda_transactions;
      `);
      db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(currencyMigrationKey);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function migrateVideoPlaybackSessions(db: DatabaseSync) {
  const columns = db.prepare("PRAGMA table_info(video_playback_sessions)").all() as Array<{
    name: string;
    notnull: number;
  }>;
  const userId = columns.find((column) => column.name === "user_id");
  const modern = columns.some((column) => column.name === "viewer_key") &&
    columns.some((column) => column.name === "client_id") &&
    columns.some((column) => column.name === "storage_node_id") &&
    columns.some((column) => column.name === "reserved_kbps") &&
    userId?.notnull === 0;
  if (modern) {
    db.exec(`
      DROP INDEX IF EXISTS idx_video_playback_sessions_user_active;
      CREATE INDEX IF NOT EXISTS idx_video_playback_sessions_viewer_active
        ON video_playback_sessions(viewer_key, expires_at, last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_video_playback_sessions_node_active
        ON video_playback_sessions(storage_node_id, expires_at, last_seen_at);
      CREATE INDEX IF NOT EXISTS idx_video_playback_sessions_expiry
        ON video_playback_sessions(expires_at);
    `);
    return;
  }

  // Playback leases live for only 90 seconds, so rebuilding is safer than
  // carrying legacy user-only sessions into the guest-aware schema.
  db.exec(`
    DROP TABLE IF EXISTS video_playback_sessions;
    CREATE TABLE video_playback_sessions (
      id TEXT PRIMARY KEY,
      viewer_key TEXT NOT NULL,
      user_id INTEGER,
      client_id TEXT NOT NULL,
      media_id INTEGER NOT NULL,
      storage_node_id TEXT,
      reserved_kbps INTEGER NOT NULL DEFAULT 0 CHECK(reserved_kbps >= 0),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(viewer_key, client_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_video_playback_sessions_viewer_active
      ON video_playback_sessions(viewer_key, expires_at, last_seen_at);
    CREATE INDEX idx_video_playback_sessions_node_active
      ON video_playback_sessions(storage_node_id, expires_at, last_seen_at);
    CREATE INDEX idx_video_playback_sessions_expiry
      ON video_playback_sessions(expires_at);
  `);
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
    [0, "访客", 0, 0, []],
    [1, "初见", 0, 3, ["video_download"]],
    [2, "熟客", 50, 5, ["advanced_search", "market_access", "market_purchase", "video_download"]],
    [3, "常驻", 200, 8, ["advanced_search", "market_access", "market_purchase", "video_download"]],
    [4, "活跃", 500, 12, ["advanced_search", "market_access", "market_purchase", "video_download"]],
    [5, "资深", 1200, 20, ["advanced_search", "market_access", "market_purchase", "video_download"]],
    [6, "核心", 2500, 30, ["advanced_search", "market_access", "market_purchase", "video_download"]],
  ] as const;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO user_levels (level, name, soda_required, daily_video_download_limit, permissions) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [level, name, sodaRequired, dailyVideoDownloadLimit, permissions] of defaults) {
    insert.run(level, name, sodaRequired, dailyVideoDownloadLimit, JSON.stringify(permissions));
  }

  const migrationKey = "user_level_defaults_v2";
  const migrated = db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(migrationKey);
  if (!migrated) {
    const levelZero = db.prepare("SELECT permissions FROM user_levels WHERE level = 0").get() as
      | { permissions: string }
      | undefined;
    if (levelZero?.permissions === JSON.stringify(["content_report", "station_message"])) {
      db.prepare("UPDATE user_levels SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE level = 0")
        .run(JSON.stringify(defaults[0][4]));
    }
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(migrationKey);
  }

  db.prepare("UPDATE user_levels SET video_concurrency_limit = 0 WHERE level = 0").run();
  db.prepare("UPDATE user_levels SET video_concurrency_limit = 1 WHERE level = 1 AND video_concurrency_limit < 1").run();

  const marketDefaultsKey = "user_level_market_defaults_v1";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(marketDefaultsKey)) {
    const rows = db
      .prepare("SELECT level, permissions FROM user_levels WHERE level >= 2")
      .all() as Array<{ level: number; permissions: string }>;
    const update = db.prepare(
      `UPDATE user_levels
       SET permissions = ?, video_concurrency_limit = ?, updated_at = CURRENT_TIMESTAMP
       WHERE level = ?`,
    );
    for (const row of rows) {
      let permissions: string[] = [];
      try {
        const parsed = JSON.parse(row.permissions);
        if (Array.isArray(parsed)) permissions = parsed.filter((item): item is string => typeof item === "string");
      } catch {
        // Invalid legacy permissions are replaced by the explicit defaults below.
      }
      permissions = [...new Set([...permissions, "market_access", "market_purchase"])];
      update.run(JSON.stringify(permissions), row.level >= 5 ? 3 : 2, row.level);
    }
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(marketDefaultsKey);
  }

  const capabilityCleanupKey = "user_level_capabilities_v3";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(capabilityCleanupKey)) {
    const baseline = new Set(["content_report", "station_message", "novel_feedback"]);
    const rows = db.prepare("SELECT level, permissions FROM user_levels").all() as Array<{ level: number; permissions: string }>;
    const update = db.prepare("UPDATE user_levels SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE level = ?");
    for (const row of rows) {
      let permissions: string[] = [];
      try {
        const parsed = JSON.parse(row.permissions);
        if (Array.isArray(parsed)) permissions = parsed.filter((item): item is string => typeof item === "string" && !baseline.has(item));
      } catch {
        permissions = [];
      }
      update.run(JSON.stringify([...new Set(permissions)]), row.level);
    }
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(capabilityCleanupKey);
  }

  const downloadPermissionCleanupKey = "user_level_remove_video_download_v1";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(downloadPermissionCleanupKey)) {
    const rows = db.prepare("SELECT level, permissions FROM user_levels").all() as Array<{ level: number; permissions: string }>;
    const update = db.prepare("UPDATE user_levels SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE level = ?");
    for (const row of rows) {
      let permissions: string[] = [];
      try {
        const parsed = JSON.parse(row.permissions);
        if (Array.isArray(parsed)) permissions = parsed.filter((item): item is string => typeof item === "string" && item !== "video_download");
      } catch {
        permissions = [];
      }
      update.run(JSON.stringify([...new Set(permissions)]), row.level);
    }
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(downloadPermissionCleanupKey);
  }

  const videoDownloadDefaultsKey = "user_level_video_download_defaults_v2";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(videoDownloadDefaultsKey)) {
    const rows = db.prepare("SELECT level, permissions FROM user_levels WHERE level >= 1").all() as Array<{ level: number; permissions: string }>;
    const update = db.prepare("UPDATE user_levels SET permissions = ?, updated_at = CURRENT_TIMESTAMP WHERE level = ?");
    for (const row of rows) {
      let permissions: string[] = [];
      try {
        const parsed = JSON.parse(row.permissions);
        if (Array.isArray(parsed)) permissions = parsed.filter((item): item is string => typeof item === "string");
      } catch {
        permissions = [];
      }
      update.run(JSON.stringify([...new Set([...permissions, "video_download"])]), row.level);
    }
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(videoDownloadDefaultsKey);
  }

  const dailyDownloadDefaultsKey = "user_level_daily_download_defaults_v1";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(dailyDownloadDefaultsKey)) {
    db.exec(`
      UPDATE user_levels
      SET daily_video_download_limit = CASE level
        WHEN 0 THEN 0
        WHEN 1 THEN 3
        WHEN 2 THEN 5
        WHEN 3 THEN 8
        WHEN 4 THEN 12
        WHEN 5 THEN 20
        WHEN 6 THEN 30
        ELSE 0
      END,
      updated_at = CURRENT_TIMESTAMP;
    `);
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(dailyDownloadDefaultsKey);
  }
}

function initialize(db: DatabaseSync) {
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrateNovelsAllowDuplicateTitles(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS novel_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      source_id INTEGER REFERENCES novel_sources(id) ON DELETE SET NULL,
      storage_mode TEXT NOT NULL DEFAULT 'single' CHECK(storage_mode IN ('single', 'chapters')),
      chapter_count INTEGER NOT NULL DEFAULT 0 CHECK(chapter_count >= 0),
      access_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(access_mode IN ('inherit', 'soda')),
      soda_price INTEGER NOT NULL DEFAULT 0 CHECK(soda_price >= 0),
      preview_chapter_count INTEGER NOT NULL DEFAULT 0 CHECK(preview_chapter_count >= 0),
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

    CREATE TABLE IF NOT EXISTS novel_chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      title_override TEXT,
      relative_path TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      sort_override INTEGER,
      content_hash TEXT,
      size_bytes INTEGER NOT NULL DEFAULT 0 CHECK(size_bytes >= 0),
      mtime_ms INTEGER NOT NULL DEFAULT 0,
      word_count INTEGER NOT NULL DEFAULT 0 CHECK(word_count >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(novel_id, sort_order),
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

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

    CREATE TABLE IF NOT EXISTS novel_recommendation_pool (
      novel_id INTEGER PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

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
      locale_preference TEXT NOT NULL DEFAULT 'zh-Hans' CHECK(locale_preference IN ('zh-Hans', 'zh-Hant')),
      reading_history_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reading_history_enabled IN (0, 1)),
      reading_progress_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reading_progress_enabled IN (0, 1)),
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
      chapter_id INTEGER,
      title TEXT NOT NULL,
      segment_index INTEGER NOT NULL DEFAULT 0,
      segment_ratio REAL NOT NULL DEFAULT 0 CHECK(segment_ratio >= 0 AND segment_ratio <= 1),
      progress_percent REAL NOT NULL DEFAULT 0 CHECK(progress_percent >= 0 AND progress_percent <= 100),
      content_version TEXT NOT NULL DEFAULT '',
      completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
      recorded_in_history INTEGER NOT NULL DEFAULT 1 CHECK(recorded_in_history IN (0, 1)),
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, novel_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE,
      FOREIGN KEY(chapter_id) REFERENCES novel_chapters(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_user_history_user_time
      ON user_reading_history(user_id, last_read_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_history_novel ON user_reading_history(novel_id);

    CREATE TABLE IF NOT EXISTS novel_read_daily_stats (
      day TEXT NOT NULL,
      novel_id INTEGER NOT NULL,
      open_count INTEGER NOT NULL DEFAULT 0 CHECK(open_count >= 0),
      resume_count INTEGER NOT NULL DEFAULT 0 CHECK(resume_count >= 0),
      completion_count INTEGER NOT NULL DEFAULT 0 CHECK(completion_count >= 0),
      progress_sample_count INTEGER NOT NULL DEFAULT 0 CHECK(progress_sample_count >= 0),
      progress_percent_sum REAL NOT NULL DEFAULT 0 CHECK(progress_percent_sum >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(day, novel_id),
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_novel_read_daily_day
      ON novel_read_daily_stats(day DESC, open_count DESC);

    CREATE TABLE IF NOT EXISTS user_read_daily_stats (
      day TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      open_count INTEGER NOT NULL DEFAULT 0 CHECK(open_count >= 0),
      resume_count INTEGER NOT NULL DEFAULT 0 CHECK(resume_count >= 0),
      completion_count INTEGER NOT NULL DEFAULT 0 CHECK(completion_count >= 0),
      progress_update_count INTEGER NOT NULL DEFAULT 0 CHECK(progress_update_count >= 0),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(day, user_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_read_daily_day
      ON user_read_daily_stats(day DESC, open_count DESC);

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
      daily_video_download_limit INTEGER NOT NULL DEFAULT 3 CHECK(daily_video_download_limit BETWEEN 0 AND 1000),
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

    CREATE TABLE IF NOT EXISTS user_novel_grove (
      user_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0 CHECK(visit_count >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, novel_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_novel_grove_user_time
      ON user_novel_grove(user_id, created_at DESC, novel_id DESC);

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
      display_mode TEXT NOT NULL DEFAULT 'list' CHECK(display_mode IN ('list', 'drawer', 'both')),
      entry_version TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS telegram_user_links (
      user_id INTEGER PRIMARY KEY,
      chat_id TEXT NOT NULL UNIQUE,
      telegram_username TEXT NOT NULL DEFAULT '',
      linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS telegram_link_tokens (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_expiry
      ON telegram_link_tokens(expires_at);

    CREATE TABLE IF NOT EXISTS telegram_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dedupe_key TEXT UNIQUE,
      method TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER NOT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      sent_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_outbox_pending
      ON telegram_outbox(status, next_attempt_at, id);

    CREATE TABLE IF NOT EXISTS telegram_updates (
      update_id INTEGER PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS telegram_message_links (
      chat_id TEXT NOT NULL,
      message_id INTEGER NOT NULL,
      station_thread_id INTEGER NOT NULL,
      station_message_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(chat_id, message_id),
      FOREIGN KEY(station_thread_id) REFERENCES station_threads(id) ON DELETE CASCADE,
      FOREIGN KEY(station_message_id) REFERENCES station_messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_telegram_message_links_thread
      ON telegram_message_links(station_thread_id, message_id);

    CREATE TABLE IF NOT EXISTS content_access_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('ip', 'cidr', 'country', 'crawler')),
      target_value TEXT NOT NULL,
      match_mode TEXT NOT NULL DEFAULT 'include' CHECK(match_mode IN ('include', 'exclude')),
      scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'video', 'audio', 'file')),
      country_mode TEXT NOT NULL DEFAULT 'all' CHECK(country_mode IN ('all', 'cn', 'non_cn')),
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
      scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'video', 'audio', 'file')),
      country_mode TEXT NOT NULL DEFAULT 'all' CHECK(country_mode IN ('all', 'cn', 'non_cn')),
      audience TEXT NOT NULL DEFAULT 'guest' CHECK(audience IN ('all', 'guest')),
      window_seconds INTEGER NOT NULL,
      max_requests INTEGER NOT NULL,
      block_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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
      playback_format TEXT NOT NULL DEFAULT 'mp4' CHECK(playback_format IN ('mp4', 'hls')),
      playback_version TEXT NOT NULL DEFAULT '',
      playback_manifest_path TEXT,
      playback_status TEXT NOT NULL DEFAULT 'none' CHECK(playback_status IN ('none', 'pending', 'processing', 'ready', 'failed')),
      playback_error TEXT NOT NULL DEFAULT '',
      playback_published_at TEXT,
      play_count INTEGER NOT NULL DEFAULT 0,
      recommend_count INTEGER NOT NULL DEFAULT 0 CHECK(recommend_count >= 0),
      download_count INTEGER NOT NULL DEFAULT 0,
      published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      content_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      new_until TEXT,
      play_soda_price INTEGER NOT NULL DEFAULT 0 CHECK(play_soda_price >= 0),
      download_soda_price INTEGER NOT NULL DEFAULT 1 CHECK(download_soda_price >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS video_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      slug TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1 CHECK(is_visible IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_asset_tags (
      media_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(media_id, tag_id),
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE,
      FOREIGN KEY(tag_id) REFERENCES video_tags(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_assets_kind_created ON media_assets(kind, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_media_assets_title ON media_assets(title);
    CREATE INDEX IF NOT EXISTS idx_video_tags_visible_sort
      ON video_tags(is_visible, sort_order, name COLLATE NOCASE, id);
    CREATE INDEX IF NOT EXISTS idx_media_asset_tags_tag_media
      ON media_asset_tags(tag_id, media_id);
    CREATE INDEX IF NOT EXISTS idx_media_asset_tags_media_tag
      ON media_asset_tags(media_id, tag_id);
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

    CREATE TABLE IF NOT EXISTS media_playback_jobs (
      media_id INTEGER PRIMARY KEY,
      source_version TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_playback_jobs_ready
      ON media_playback_jobs(status, updated_at, media_id);

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

    CREATE TABLE IF NOT EXISTS user_media_grove (
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0 CHECK(visit_count >= 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, media_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_media_grove_user_time
      ON user_media_grove(user_id, created_at DESC, media_id DESC);

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
  dropLegacyContentAccessBans(db);
  migrateContentReports(db);
  migrateContentAccessSchema(db);
  addColumnIfMissing(
    db,
    "announcements",
    "display_mode",
    "display_mode TEXT NOT NULL DEFAULT 'list' CHECK(display_mode IN ('list', 'drawer', 'both'))",
  );
  addColumnIfMissing(db, "announcements", "entry_version", "entry_version TEXT NOT NULL DEFAULT ''");
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_announcements_entry_visible ON announcements(display_mode, status, audience, importance, published_at, expires_at);",
  );
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_content_access_rules_match
      ON content_access_rules(enabled, scope, country_mode, audience, target_type, target_value);
    CREATE INDEX IF NOT EXISTS idx_content_access_rules_expiry
      ON content_access_rules(expires_at);
    CREATE INDEX IF NOT EXISTS idx_content_access_policies_enabled
      ON content_access_policies(enabled, scope, country_mode, audience);
  `);
  migrateUserEconomy(db);
  migrateMarketplaceAndRegistration(db);
  addColumnIfMissing(db, "user_entitlements", "granted_by", "granted_by TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "user_entitlements", "updated_at", "updated_at TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE user_entitlements SET updated_at = created_at WHERE updated_at = '';");
  db.exec("CREATE INDEX IF NOT EXISTS idx_user_entitlements_user_expiry ON user_entitlements(user_id, expires_at, id DESC);");
  migrateVideoPlaybackSessions(db);
  migrateNovelRecommendations(db);
  migrateNovelLibraryModel(db);
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
  addColumnIfMissing(db, "media_assets", "playback_format", "playback_format TEXT NOT NULL DEFAULT 'mp4' CHECK(playback_format IN ('mp4', 'hls'))");
  addColumnIfMissing(db, "media_assets", "playback_version", "playback_version TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "media_assets", "playback_manifest_path", "playback_manifest_path TEXT");
  addColumnIfMissing(db, "media_assets", "playback_status", "playback_status TEXT NOT NULL DEFAULT 'none' CHECK(playback_status IN ('none', 'pending', 'processing', 'ready', 'failed'))");
  addColumnIfMissing(db, "media_assets", "playback_error", "playback_error TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing(db, "media_assets", "playback_published_at", "playback_published_at TEXT");
  const playbackJobsMigrationKey = "media_playback_jobs_v1";
  if (!db.prepare("SELECT 1 AS found FROM app_metadata WHERE key = ?").get(playbackJobsMigrationKey)) {
    db.exec("BEGIN");
    try {
      db.exec(`
        INSERT OR IGNORE INTO media_playback_jobs (media_id, source_version, status, last_error)
        SELECT id,
               CAST(mtime_ms AS INTEGER) || '-' || CAST(size_bytes AS INTEGER),
               CASE WHEN playback_status = 'processing' THEN 'pending' ELSE playback_status END,
               playback_error
        FROM media_assets
        WHERE kind = 'video' AND playback_status IN ('pending', 'processing');

        UPDATE media_assets
        SET playback_status = CASE
              WHEN playback_format = 'hls' AND playback_manifest_path IS NOT NULL AND playback_version <> '' THEN 'ready'
              ELSE 'none'
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE playback_status IN ('pending', 'processing');
      `);
      db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, '1')").run(playbackJobsMigrationKey);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  addColumnIfMissing(db, "media_assets", "recommend_count", "recommend_count INTEGER NOT NULL DEFAULT 0 CHECK(recommend_count >= 0)");
  addColumnIfMissing(db, "media_assets", "category_id", "category_id INTEGER REFERENCES video_categories(id) ON DELETE SET NULL");
  addColumnIfMissing(db, "media_assets", "published_at", "published_at TEXT");
  addColumnIfMissing(db, "media_assets", "content_updated_at", "content_updated_at TEXT");
  addColumnIfMissing(db, "media_assets", "new_until", "new_until TEXT");
  addColumnIfMissing(db, "media_assets", "play_soda_price", "play_soda_price INTEGER NOT NULL DEFAULT 0 CHECK(play_soda_price >= 0)");
  addColumnIfMissing(db, "media_assets", "download_soda_price", "download_soda_price INTEGER NOT NULL DEFAULT 1 CHECK(download_soda_price >= 0)");
  db.exec("UPDATE media_assets SET published_at = COALESCE(published_at, created_at), content_updated_at = COALESCE(content_updated_at, updated_at);");
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
  addColumnIfMissing(
    db,
    "users",
    "locale_preference",
    "locale_preference TEXT NOT NULL DEFAULT 'zh-Hans' CHECK(locale_preference IN ('zh-Hans', 'zh-Hant'))",
  );
  addColumnIfMissing(
    db,
    "users",
    "reading_history_enabled",
    "reading_history_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reading_history_enabled IN (0, 1))",
  );
  addColumnIfMissing(
    db,
    "users",
    "reading_progress_enabled",
    "reading_progress_enabled INTEGER NOT NULL DEFAULT 1 CHECK(reading_progress_enabled IN (0, 1))",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "chapter_id",
    "chapter_id INTEGER REFERENCES novel_chapters(id) ON DELETE SET NULL",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "segment_ratio",
    "segment_ratio REAL NOT NULL DEFAULT 0 CHECK(segment_ratio >= 0 AND segment_ratio <= 1)",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "progress_percent",
    "progress_percent REAL NOT NULL DEFAULT 0 CHECK(progress_percent >= 0 AND progress_percent <= 100)",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "content_version",
    "content_version TEXT NOT NULL DEFAULT ''",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "completed",
    "completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1))",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "recorded_in_history",
    "recorded_in_history INTEGER NOT NULL DEFAULT 1 CHECK(recorded_in_history IN (0, 1))",
  );
  addColumnIfMissing(
    db,
    "user_reading_history",
    "updated_at",
    "updated_at TEXT NOT NULL DEFAULT ''",
  );
  db.exec("UPDATE user_reading_history SET updated_at = last_read_at WHERE updated_at = '';");
  cleanupObsoleteHistoryColumns(db);
  db.exec("DROP INDEX IF EXISTS idx_user_history_user_time;");
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_user_history_user_time
     ON user_reading_history(user_id, recorded_in_history, last_read_at DESC)`,
  );
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
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_kind_published ON media_assets(kind, published_at DESC, id DESC);");
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_assets_kind_content_updated ON media_assets(kind, content_updated_at DESC, id DESC);");
  db.exec("DROP INDEX IF EXISTS idx_media_assets_video_author;");
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

  const db = new DatabaseSync(databasePath);
  db.function("natural_sort_key", { deterministic: true }, naturalSortKey);
  initialize(db);
  globalForDb.novelReaderDb = db;
  return db;
}
