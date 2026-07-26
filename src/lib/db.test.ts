import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("removes legacy search tables and the retired content index database", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-search-migration-"));
  const databasePath = path.join(root, "novels.db");
  const legacyPath = path.join(root, "content-index.db");
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSearchPath = process.env.CONTENT_SEARCH_DB_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  process.env.DATABASE_PATH = databasePath;
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "admin-settings.json");

  const seed = new DatabaseSync(databasePath);
  seed.exec(`
    CREATE TABLE search_index_state (novel_id INTEGER PRIMARY KEY);
    CREATE TABLE content_search_terms (term TEXT NOT NULL, novel_id INTEGER NOT NULL);
    CREATE TABLE content_index_jobs (id TEXT PRIMARY KEY);
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
    CREATE TABLE novel_recommendations (
      novel_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(novel_id, user_id)
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
    INSERT INTO novel_recommendations (novel_id, user_id, created_at)
    VALUES (1, 1, '2026-07-25 10:00:00');
    INSERT INTO content_reports (user_id, novel_id, category)
    VALUES (1, 1, 'tag_error');
    INSERT INTO media_assets (kind, title, file_name, stored_name, mime_type, size_bytes)
    VALUES ('audio', 'legacy audio', 'legacy.mp3', 'legacy.mp3', 'audio/mpeg', 10);
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
  `);
  seed.close();
  fs.writeFileSync(legacyPath, "retired derived database", "utf8");

  let db: DatabaseSync | undefined;
  try {
    const { getDb } = await import("./db");
    db = getDb();
    const legacyTables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('search_index_state', 'content_search_terms', 'content_index_jobs')`,
      )
      .all();
    assert.deepEqual(legacyTables, []);
    const legacyRateLimitTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_rate_limit_bans'")
      .get();
    assert.equal(legacyRateLimitTable, undefined);
    const legacyBanTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'rate_limit_bans'")
      .get();
    assert.equal(legacyBanTable, undefined);
    const migratedBan = db
      .prepare(
        `SELECT target_type, target_value, match_mode, scope, audience, source, expires_at
         FROM content_access_rules WHERE target_value = '198.51.100.8'`,
      )
      .get() as {
        target_type: string;
        target_value: string;
        match_mode: string;
        scope: string;
        audience: string;
        source: string;
        expires_at: number;
      };
    assert.deepEqual(
      {
        targetType: migratedBan.target_type,
        targetValue: migratedBan.target_value,
        matchMode: migratedBan.match_mode,
        scope: migratedBan.scope,
        audience: migratedBan.audience,
        source: migratedBan.source,
      },
      {
        targetType: "ip",
        targetValue: "198.51.100.8",
        matchMode: "include",
        scope: "all",
        audience: "all",
        source: "rate_limit",
      },
    );
    assert.ok(migratedBan.expires_at > Date.now());
    assert.equal(fs.existsSync(legacyPath), false);
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
    for (const tableName of ["user_novel_favorites", "user_hidden_tags"]) {
      assert.equal(
        (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { name: string }).name,
        tableName,
      );
    }
    const recommendationColumns = db.prepare("PRAGMA table_info(novel_recommendations)").all() as Array<{ name: string }>;
    assert.equal(recommendationColumns.some((column) => column.name === "recommendation_date"), true);
    assert.equal((db.prepare("SELECT recommend_count FROM novels").get() as { recommend_count: number }).recommend_count, 1);
    assert.doesNotThrow(() => {
      db!.prepare(
        "INSERT INTO content_reports (user_id, novel_id, category) VALUES (1, 1, 'title_error')",
      ).run();
    });
    assert.equal(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_reports'").get() as { name: string }).name,
      "content_reports",
    );
    assert.equal((db.prepare("SELECT visit_count FROM user_reading_history").get() as { visit_count: number }).visit_count, 2);
    assert.equal((db.prepare("SELECT visit_count FROM user_media_history").get() as { visit_count: number }).visit_count, 3);
    const mediaColumns = db.prepare("PRAGMA table_info(media_assets)").all() as Array<{ name: string }>;
    assert.equal(mediaColumns.some((column) => column.name === "category_id"), true);
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
    const pinnedTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pinned_novels'")
      .get() as { name: string } | undefined;
    assert.equal(pinnedTable?.name, "pinned_novels");
    const pinnedIndexes = db.prepare("PRAGMA index_list(pinned_novels)").all() as Array<{ name: string }>;
    assert.equal(pinnedIndexes.some((index) => index.name === "idx_pinned_novels_sort"), true);

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
    assert.equal(pinNovel(2), true);
    assert.equal(pinNovel(1), true);
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [2, 1]);
    assert.equal(replacePinnedNovels([1, 2]), 2);
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [1, 2]);
    assert.throws(() => replacePinnedNovels([2, 999]), /不存在/);
    assert.deepEqual(listPinnedNovels().map((book) => book.id), [1, 2]);
    assert.deepEqual(listNovels({ pageSize: 5 }).books.slice(0, 2).map((book) => book.id), [1, 2]);

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
    assert.equal(promoted.slice(2, 6).some((id) => id === 1 || id === 2), false);

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

    db.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    fs.writeFileSync(legacyPath, "configured current search database", "utf8");
    process.env.CONTENT_SEARCH_DB_PATH = legacyPath;
    db = getDb();
    assert.equal(fs.existsSync(legacyPath), true);
  } finally {
    db?.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    if (previousSearchPath === undefined) {
      delete process.env.CONTENT_SEARCH_DB_PATH;
    } else {
      process.env.CONTENT_SEARCH_DB_PATH = previousSearchPath;
    }
    if (previousSettingsPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
