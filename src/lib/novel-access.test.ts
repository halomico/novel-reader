import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { grantUserEntitlement } from "./entitlements";
import {
  getNovelPreviewChapterCount,
  getNovelReadAccess,
  getSodaNovelPreviewSegments,
  listReadableNovelIds,
  unlockNovelWithSoda,
} from "./novel-access";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-novel-access-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  const defaults = readSiteSettings();
  writeSiteSettings({
    ...defaults,
    homePortalAccessModes: { ...defaults.homePortalAccessModes, novels: "public" },
  });
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    delete (globalThis as typeof globalThis & { siteSettingsCache?: unknown }).siteSettingsCache;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("supports chapter previews and idempotent permanent soda unlocks", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const sourceId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('paid', 'Paid', 'paid')",
  ).run().lastInsertRowid);
  const novelId = Number(db.prepare(
    `INSERT INTO novels (
       title, file_name, relative_path, source_id, storage_mode, chapter_count,
       access_mode, soda_price, preview_chapter_count, size_bytes, mtime_ms
     ) VALUES ('Paid book', 'paid-book', 'paid/paid-book', ?, 'chapters', 3, 'soda', 4, 0, 30, 1)`,
  ).run(sourceId).lastInsertRowid);
  const userId = Number(db.prepare(
    "INSERT INTO users (username, display_name, password_hash, soda_balance) VALUES ('reader', 'Reader', 'hash', 6)",
  ).run().lastInsertRowid);
  const sourceReaderId = Number(db.prepare(
    "INSERT INTO users (username, display_name, password_hash) VALUES ('source-reader', 'Source reader', 'hash')",
  ).run().lastInsertRowid);
  const book = {
    id: novelId,
    source_id: sourceId,
    storage_mode: "chapters" as const,
    chapter_count: 3,
    access_mode: "soda" as const,
    soda_price: 4,
    preview_chapter_count: 0,
  };

  assert.equal(getNovelPreviewChapterCount(book), 1);
  assert.equal(getNovelReadAccess(book, null, { chapterSortOrder: 0 }).reason, "preview");
  assert.equal(getNovelReadAccess(book, null, { chapterSortOrder: 1 }).reason, "login_required");
  assert.equal(getNovelReadAccess(book, { id: userId, role: "user" }, { chapterSortOrder: 1 }).reason, "unlock_required");
  assert.deepEqual(unlockNovelWithSoda(userId, novelId), { ok: true, charged: true, sodaBalance: 2 });
  assert.deepEqual(unlockNovelWithSoda(userId, novelId), { ok: true, charged: false, sodaBalance: 2 });
  assert.equal(getNovelReadAccess(book, { id: userId, role: "user" }, { chapterSortOrder: 0 }).reason, "granted");
  assert.equal(getNovelReadAccess(book, { id: userId, role: "user" }, { chapterSortOrder: 1 }).reason, "granted");
  assert.deepEqual(listReadableNovelIds({ id: userId, role: "user" }), [novelId]);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source = 'novel_unlock'").get() as { count: number }).count,
    1,
  );

  grantUserEntitlement({
    userId: sourceReaderId,
    definition: { targetType: "novel_source", targetId: String(sourceId), rights: ["read"], durationSeconds: null },
  });
  assert.equal(getNovelReadAccess(book, { id: sourceReaderId, role: "user" }).reason, "granted");
});

test("limits locked single-file novels to an approximately 30 percent preview", (t) => {
  withTempDatabase(t);
  const book = {
    id: 999,
    source_id: null,
    storage_mode: "single" as const,
    chapter_count: 0,
    access_mode: "soda" as const,
    soda_price: 3,
    preview_chapter_count: 0,
  };
  const segments = Array.from({ length: 10 }, (_, index) => ({
    segmentIndex: index,
    charStart: index * 10,
    charEnd: index * 10 + 10,
    content: String(index).repeat(10),
  }));

  assert.equal(getNovelReadAccess(book, null).reason, "login_required");
  assert.equal(getNovelReadAccess(book, null, { contentPreview: true }).reason, "preview");
  assert.equal(getNovelReadAccess(book, { id: 42, role: "user" }, { contentPreview: true }).reason, "preview");
  const preview = getSodaNovelPreviewSegments(segments);
  assert.equal(preview.map((segment) => segment.content).join("").length, 30);
  assert.deepEqual(preview.map((segment) => segment.segmentIndex), [0, 1, 2]);
});
