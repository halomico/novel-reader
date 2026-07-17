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
  process.env.DATABASE_PATH = databasePath;

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
    fs.rmSync(root, { recursive: true, force: true });
  }
});
