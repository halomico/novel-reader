import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Novel } from "./books";

test("separates exact reading progress from durable aggregate analytics", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-progress-"));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "admin-settings.json");

  const { getDb } = await import("./db");
  const {
    clearReadingProgress,
    getReadingAnalytics,
    getReadingProgress,
    listReadingProgressPage,
    recordReadingOpen,
    updateReadingProgress,
  } = await import("./reading-progress");
  const db = getDb();
  db.prepare(
    `INSERT INTO users (username, display_name, password_hash)
     VALUES ('reader', 'Reader', 'test-hash')`,
  ).run();
  db.prepare(
    `INSERT INTO novels (
       title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count
     )
     VALUES ('Progress Novel', 'progress.txt', 'progress.txt', 'version-1', 100, 10, 1000)`,
  ).run();
  const book = db.prepare("SELECT * FROM novels WHERE id = 1").get() as Novel;

  recordReadingOpen(1, book);
  const updated = updateReadingProgress(1, book, {
    segmentIndex: 4,
    segmentRatio: 0.25,
    progressPercent: 42,
    contentVersion: "version-1",
    completed: false,
  });
  assert.equal(updated.saved, true);
  assert.equal(Math.round(getReadingProgress(1, 1)?.progressPercent || 0), 42);
  assert.equal(listReadingProgressPage(1).items[0]?.novelId, 1);

  recordReadingOpen(1, book);
  db.prepare("UPDATE users SET reading_history_enabled = 0 WHERE id = 1").run();
  recordReadingOpen(1, book);
  assert.equal(getReadingProgress(1, 1)?.visitCount, 2);
  assert.equal(updateReadingProgress(1, book, {
    segmentIndex: 5,
    segmentRatio: 0.5,
    progressPercent: 50,
    contentVersion: "version-1",
    completed: false,
  }).saved, false);
  assert.equal(Math.round(getReadingProgress(1, 1)?.progressPercent || 0), 42);

  assert.equal(clearReadingProgress(1), 1);
  assert.equal(Math.round(getReadingProgress(1, 1)?.progressPercent || 0), 42);
  assert.equal(listReadingProgressPage(1).totalItems, 0);
  assert.equal(updateReadingProgress(1, book, {
    segmentIndex: 6,
    segmentRatio: 0.25,
    progressPercent: 60,
    contentVersion: "version-1",
    completed: false,
  }).saved, false);
  assert.equal(Math.round(getReadingProgress(1, 1)?.progressPercent || 0), 42);
  assert.equal(listReadingProgressPage(1).totalItems, 0);

  db.prepare("UPDATE users SET reading_history_enabled = 1 WHERE id = 1").run();
  recordReadingOpen(1, book);
  assert.equal(listReadingProgressPage(1).totalItems, 1);
  db.prepare("UPDATE users SET reading_progress_enabled = 0 WHERE id = 1").run();
  recordReadingOpen(1, book);
  assert.equal(updateReadingProgress(1, book, {
    segmentIndex: 7,
    segmentRatio: 0.5,
    progressPercent: 70,
    contentVersion: "version-1",
    completed: false,
  }).saved, true);
  assert.equal(Math.round(getReadingProgress(1, 1)?.progressPercent || 0), 70);

  const beforeClear = getReadingAnalytics(1, 10);
  assert.equal(beforeClear.opens, 5);
  assert.equal(clearReadingProgress(1), 1);
  assert.equal(Math.round(getReadingProgress(1, 1)?.progressPercent || 0), 70);
  assert.equal(listReadingProgressPage(1).totalItems, 0);
  assert.equal(getReadingAnalytics(1, 10).opens, 5);

  if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
  else process.env.DATABASE_PATH = previousDatabasePath;
  if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
  else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
});
