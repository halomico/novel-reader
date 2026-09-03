import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("migrates supported application data and discards retired access records", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-search-migration-"));
  const databasePath = path.join(root, "novels.db");
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  process.env.DATABASE_PATH = databasePath;
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "admin-settings.json");

  const seed = new DatabaseSync(databasePath);
  seed.exec(`
    CREATE TABLE search_rate_limit_bans (
      ip TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      banned_until INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE rate_limit_bans (
      ip TEXT NOT NULL,
      category TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      is_permanent INTEGER NOT NULL DEFAULT 0,
      banned_until INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(ip, category)
    );
    CREATE TABLE content_access_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'all',
      audience TEXT NOT NULL DEFAULT 'all',
      source TEXT NOT NULL DEFAULT 'manual',
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
      scope TEXT NOT NULL DEFAULT 'all',
      audience TEXT NOT NULL DEFAULT 'guest',
      window_seconds INTEGER NOT NULL,
      max_requests INTEGER NOT NULL,
      block_seconds INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      search_rate_limit_per_minute INTEGER,
      history_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT,
      last_login_ip TEXT
    );
    CREATE TABLE original_reading_history (
      user_id INTEGER NOT NULL,
      article_id INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(user_id, article_id)
    );
    CREATE TABLE novel_recommendations (
      novel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      recommendation_date TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(novel_id, user_id, recommendation_date)
    );
    CREATE TABLE content_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('tag_error', 'hotword_error', 'spam', 'other')),
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      play_count INTEGER NOT NULL DEFAULT 0,
      download_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE media_recommendations (
      media_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      recommendation_date TEXT NOT NULL,
      soda_spent INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(media_id, user_id, recommendation_date)
    );
    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX idx_tags_visible_sort ON tags(is_visible, sort_order, name);
    CREATE TABLE user_reading_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      novel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      segment_index INTEGER NOT NULL DEFAULT 0,
      visit_count INTEGER NOT NULL DEFAULT 0,
      hidden_by_user INTEGER NOT NULL DEFAULT 0,
      last_read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, novel_id)
    );
    CREATE TABLE user_media_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      media_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0,
      hidden_by_user INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, media_id)
    );
    INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms)
    VALUES ('legacy novel', 'legacy.txt', 'legacy.txt', 10, 1);
    INSERT INTO users (username, display_name, password_hash, history_visible)
    VALUES ('legacy-user', 'Legacy User', 'test-hash', 0);
    INSERT INTO novel_recommendations (novel_id, user_id, recommendation_date, created_at)
    VALUES (1, 1, '2026-07-25', '2026-07-25 10:00:00');
    INSERT INTO novel_recommendations (novel_id, user_id, recommendation_date, created_at)
    VALUES (1, 1, '2026-07-26', '2026-07-26 10:00:00');
    INSERT INTO content_reports (user_id, novel_id, category)
    VALUES (1, 1, 'tag_error');
    INSERT INTO media_assets (kind, title, file_name, stored_name, mime_type, size_bytes)
    VALUES ('audio', 'legacy audio', 'legacy.mp3', 'legacy.mp3', 'audio/mpeg', 10);
    INSERT INTO media_recommendations (media_id, user_id, recommendation_date, created_at)
    VALUES (1, 1, '2026-07-25', '2026-07-25 10:00:00');
    INSERT INTO media_recommendations (media_id, user_id, recommendation_date, created_at)
    VALUES (1, 1, '2026-07-26', '2026-07-26 10:00:00');
    INSERT INTO tags (name, slug, is_visible) VALUES ('公开标签', 'public-tag', 1);
    INSERT INTO tags (name, slug, is_visible) VALUES ('隐藏标签', 'hidden-tag', 0);
    INSERT INTO user_reading_history (user_id, novel_id, title, visit_count, hidden_by_user)
    VALUES (1, 1, 'legacy novel', 2, 1);
    INSERT INTO user_media_history (user_id, media_id, kind, title, visit_count, hidden_by_user)
    VALUES (1, 1, 'audio', 'legacy audio', 3, 1);
    INSERT INTO search_rate_limit_bans (ip, rule_id, is_permanent, banned_until)
    VALUES ('203.0.113.9', 'legacy-search-rule', 1, NULL);
    INSERT INTO rate_limit_bans (ip, category, rule_id, is_permanent, banned_until)
    VALUES ('198.51.100.8', 'content', 'legacy-content-rule', 1, NULL);
    INSERT INTO content_access_rules (target_type, target_value, scope)
    VALUES ('ip', '192.0.2.10', 'media');
    INSERT INTO content_access_policies (name, scope, window_seconds, max_requests, block_seconds)
    VALUES ('旧策略', 'media', 60, 10, 300);
  `);
  seed.close();

  let db: DatabaseSync | undefined;
  try {
    const { getDb } = await import("./db");
    db = getDb();
    const legacyRateLimitTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_rate_limit_bans'")
      .get();
    assert.equal(legacyRateLimitTable, undefined);
    const legacyBanTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit_bans'")
      .get();
    assert.equal(legacyBanTable, undefined);
    const discardedLegacyBan = db
      .prepare(
        `SELECT target_type, target_value, match_mode, scope, audience, source, expires_at
         FROM content_access_rules WHERE target_value = '198.51.100.8'`,
      )
      .get();
    assert.equal(discardedLegacyBan, undefined);
    const accessRuleSchema = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'content_access_rules'")
      .get() as { sql: string };
    assert.match(accessRuleSchema.sql, /country_mode/);
    assert.match(accessRuleSchema.sql, /'video'/);
    assert.doesNotMatch(accessRuleSchema.sql, /'media'/);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM content_access_rules").get() as { count: number }).count,
      0,
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM content_access_policies").get() as { count: number }).count,
      0,
    );
    const obsoleteColumns = [
      ["users", "history_visible"],
      ["user_reading_history", "hidden_by_user"],
      ["user_media_history", "hidden_by_user"],
    ] as const;
    for (const [tableName, columnName] of obsoleteColumns) {
      const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
      assert.equal(columns.some((column) => column.name === columnName), false);
    }
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count, 1);
    const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
    assert.equal(userColumns.some((column) => column.name === "role"), true);
    assert.equal(userColumns.some((column) => column.name === "trust_level"), true);
    assert.equal(userColumns.some((column) => column.name === "soda_balance"), true);
    assert.equal(userColumns.some((column) => column.name === "soda_experience"), true);
    assert.equal(userColumns.some((column) => column.name === "locale_preference"), true);
    assert.equal(userColumns.some((column) => column.name === "reading_history_enabled"), true);
    assert.equal(userColumns.some((column) => column.name === "original_reading_history_enabled"), true);
    assert.equal(userColumns.some((column) => column.name === "reading_progress_enabled"), true);
    assert.deepEqual(
      { ...(db.prepare(
        "SELECT locale_preference, reading_history_enabled, original_reading_history_enabled, reading_progress_enabled FROM users",
      ).get() as object) },
      {
        locale_preference: "zh-Hans",
        reading_history_enabled: 1,
        original_reading_history_enabled: 1,
        reading_progress_enabled: 1,
      },
    );
    const readingHistoryColumns = db
      .prepare("PRAGMA table_info(user_reading_history)")
      .all() as Array<{ name: string }>;
    assert.equal(
      readingHistoryColumns.some((column) => column.name === "recorded_in_history"),
      true,
    );
    const originalReadingHistoryColumns = db
      .prepare("PRAGMA table_info(original_reading_history)")
      .all() as Array<{ name: string }>;
    for (const columnName of ["scroll_ratio", "progress_percent", "completed", "recorded_in_history", "updated_at"]) {
      assert.equal(originalReadingHistoryColumns.some((column) => column.name === columnName), true);
    }
    assert.equal((db.prepare("SELECT role FROM users").get() as { role: string }).role, "user");
    assert.deepEqual(
      { ...(db.prepare("SELECT trust_level, soda_balance, soda_experience FROM users").get() as object) },
      { trust_level: 3, soda_balance: 0, soda_experience: 200 },
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM user_levels").get() as { count: number }).count,
      7,
    );
    assert.equal(
      (db.prepare("SELECT soda_required FROM user_levels WHERE level = 6").get() as { soda_required: number }).soda_required,
      2500,
    );
    for (const tableName of ["user_novel_favorites", "user_original_favorites", "user_original_grove", "user_original_author_blocks", "user_hidden_tags"]) {
      assert.equal(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { name: string }).name,
        tableName,
      );
    }
    const recommendationColumns = db.prepare("PRAGMA table_info(novel_recommendations)").all() as Array<{ name: string }>;
    assert.equal(recommendationColumns.some((column) => column.name === "recommendation_date"), false);
    const mediaRecommendationColumns = db.prepare("PRAGMA table_info(media_recommendations)").all() as Array<{ name: string }>;
    assert.equal(mediaRecommendationColumns.some((column) => column.name === "recommendation_date"), false);
    assert.equal((db.prepare("SELECT recommend_count FROM novels").get() as { recommend_count: number }).recommend_count, 1);
    assert.equal((db.prepare("SELECT recommend_count FROM media_assets").get() as { recommend_count: number }).recommend_count, 1);
    assert.doesNotThrow(() => {
      db!.prepare(
        "INSERT INTO content_reports (user_id, novel_id, category) VALUES (1, 1, 'title_error')",
      ).run();
    });
    assert.equal(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_reports'").get() as { name: string }).name,
      "content_reports",
    );
    const reportColumns = db.prepare("PRAGMA table_info(content_reports)").all() as Array<{ name: string }>;
    assert.equal(reportColumns.some((column) => column.name === "original_article_id"), true);
    assert.equal((db.prepare("SELECT visit_count FROM user_reading_history").get() as { visit_count: number }).visit_count, 2);
    const readingColumns = db.prepare("PRAGMA table_info(user_reading_history)").all() as Array<{ name: string }>;
    for (const columnName of ["segment_ratio", "progress_percent", "content_version", "completed", "updated_at"]) {
      assert.equal(readingColumns.some((column) => column.name === columnName), true);
    }
    for (const tableName of ["novel_read_daily_stats", "user_read_daily_stats"]) {
      assert.equal(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { name: string }).name,
        tableName,
      );
    }
    assert.equal((db.prepare("SELECT visit_count FROM user_media_history").get() as { visit_count: number }).visit_count, 3);
    const mediaColumns = db.prepare("PRAGMA table_info(media_assets)").all() as Array<{ name: string }>;
    assert.equal(mediaColumns.some((column) => column.name === "category_id"), true);
    assert.equal(mediaColumns.some((column) => column.name === "storage_node_id"), true);
    assert.equal(mediaColumns.some((column) => column.name === "custom_cover_key"), true);
    assert.equal(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_prepare_jobs'").get() as { name: string }).name,
      "media_prepare_jobs",
    );
    const mediaPreparationIndexes = db.prepare("PRAGMA index_list(media_prepare_jobs)").all() as Array<{ name: string }>;
    assert.equal(mediaPreparationIndexes.some((index) => index.name === "idx_media_prepare_jobs_ready"), true);
    const tagColumns = db.prepare("PRAGMA table_info(tags)").all() as Array<{ name: string }>;
    assert.equal(tagColumns.some((column) => column.name === "is_visible"), false);
    assert.equal(tagColumns.some((column) => column.name === "visibility"), true);
    assert.deepEqual(
      db.prepare("SELECT slug, visibility FROM tags ORDER BY id").all().map((row) => ({ ...row })),
      [
        { slug: "public-tag", visibility: "public" },
        { slug: "hidden-tag", visibility: "hidden" },
      ],
    );
    const mediaIndexes = db.prepare("PRAGMA index_list(media_assets)").all() as Array<{ name: string }>;
    assert.equal(mediaIndexes.some((index) => index.name === "idx_media_assets_video_category"), true);
    assert.equal(mediaIndexes.some((index) => index.name === "idx_media_assets_storage_node"), true);
    const pinnedTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pinned_novels'")
      .get() as { name: string } | undefined;
    assert.equal(pinnedTable?.name, "pinned_novels");
    const pinnedIndexes = db.prepare("PRAGMA index_list(pinned_novels)").all() as Array<{ name: string }>;
    assert.equal(pinnedIndexes.some((index) => index.name === "idx_pinned_novels_sort"), true);
    assert.equal(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'novel_recommendation_pool'")
          .get() as { name: string }
      ).name,
      "novel_recommendation_pool",
    );

    db.exec(`
      DELETE FROM user_reading_history;
      DELETE FROM user_media_history;
      DELETE FROM users;
      DELETE FROM novels;
      DELETE FROM media_assets;
      DELETE FROM sqlite_sequence WHERE name IN ('user_reading_history', 'user_media_history', 'users', 'novels', 'media_assets');
    `);

    const insertNovel = db.prepare(
      "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES (?, ?, ?, ?, ?)",
    );
    for (let index = 1; index <= 40; index += 1) {
      const suffix = String(index).padStart(2, "0");
      insertNovel.run(`小说 ${suffix}`, `${suffix}.txt`, `${suffix}.txt`, index * 100, index);
    }
    const { listNovels } = await import("./books");
    const { listPinnedNovels, pinNovel, replacePinnedNovels } = await import("./pinned-novels");
    const {
      countRecommendationPoolNovels,
      listRecommendationPoolNovelIds,
      setNovelRecommendationPool,
    } = await import("./recommendation-pool");
    assert.equal(pinNovel(2), true);
    assert.equal(pinNovel(1), true);
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [2, 1]);
    assert.equal(replacePinnedNovels([1, 2]), 2);
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [1, 2]);
    assert.throws(() => replacePinnedNovels([2, 999]), /不存在/);
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [1, 2]);
    assert.deepEqual(listNovels({ pageSize: 5 }).books.slice(0, 2).map((book) => book.id), [1, 2]);
    for (let id = 1; id <= 8; id += 1) {
      setNovelRecommendationPool(id, true);
    }
    setNovelRecommendationPool(8, false);
    assert.deepEqual(listRecommendationPoolNovelIds(), [1, 2, 3, 4, 5, 6, 7]);
    setNovelRecommendationPool(8, true);
    assert.equal(countRecommendationPoolNovels(), 8);

    const { readSiteSettings, writeSiteSettings } = await import("./site-settings");
    writeSiteSettings({
      ...readSiteSettings(),
      randomRecommendationsEnabled: true,
      randomRecommendationCount: 4,
      randomRecommendationIntervalMinutes: 60,
    });
    const promoted = listNovels({ pageSize: 8 }).books.map((book) => book.id);
    assert.deepEqual(promoted.slice(0, 2), [1, 2]);
    assert.equal(new Set(promoted.slice(2, 6)).size, 4);
    assert.equal(promoted.slice(2, 6).every((id) => id >= 3 && id <= 8), true);

    const randomA = listNovels({ pageSize: 12, randomSeed: "stable-seed" });
    const randomARepeat = listNovels({ pageSize: 12, randomSeed: "stable-seed" });
    const randomB = listNovels({ pageSize: 12, randomSeed: "different-seed" });
    assert.equal(randomA.books.length, 12);
    assert.equal(new Set(randomA.books.map((book) => book.id)).size, 12);
    assert.deepEqual(randomA.books.map((book) => book.id), randomARepeat.books.map((book) => book.id));
    assert.notDeepEqual(randomA.books.map((book) => book.id), randomB.books.map((book) => book.id));
    assert.equal(randomA.totalPages, 1);

    db.prepare("DELETE FROM novels WHERE id = 1").run();
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [2]);
    assert.equal(listRecommendationPoolNovelIds().includes(1), false);

    db.close();
    db = undefined;
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
  } finally {
    db?.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSettingsPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    }
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (process.platform !== "win32" || (error as NodeJS.ErrnoException).code !== "EPERM") {
        throw error;
      }
    }
  }
});
