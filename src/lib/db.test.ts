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
    assert.equal(fs.existsSync(legacyPath), false);
    const mediaColumns = db.prepare("PRAGMA table_info(media_assets)").all() as Array<{ name: string }>;
    assert.equal(mediaColumns.some((column) => column.name === "category_id"), true);
    const mediaIndexes = db.prepare("PRAGMA index_list(media_assets)").all() as Array<{ name: string }>;
    assert.equal(mediaIndexes.some((index) => index.name === "idx_media_assets_video_category"), true);
    const pinnedTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'pinned_novels'")
      .get() as { name: string } | undefined;
    assert.equal(pinnedTable?.name, "pinned_novels");
    const pinnedIndexes = db.prepare("PRAGMA index_list(pinned_novels)").all() as Array<{ name: string }>;
    assert.equal(pinnedIndexes.some((index) => index.name === "idx_pinned_novels_sort"), true);

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
