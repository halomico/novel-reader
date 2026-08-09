import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { createContentReport, deleteContentReport, listContentReports, setContentReportStatus } from "./reports";
import { createUserRecord } from "./users";

function resetDb() {
  const globalState = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  globalState.novelReaderDb?.close();
  delete globalState.novelReaderDb;
}

function withTempDatabase(t: TestContext) {
  const previousPath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-reports-"));
  process.env.DATABASE_PATH = path.join(root, "reports.db");
  resetDb();
  t.after(() => {
    resetDb();
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
}

test("enforces report roles, validation, daily limits, and status changes", (t) => {
  withTempDatabase(t);
  const userId = createUserRecord({ username: "reader", displayName: "Reader", passwordHash: "hash", role: "user" });
  const adminId = createUserRecord({ username: "moderator", displayName: "Moderator", passwordHash: "hash", role: "admin" });
  const novelId = Number(getDb()
    .prepare("INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES (?, ?, ?, ?, ?)")
    .run("测试小说", "test.txt", "test.txt", 10, 1).lastInsertRowid);

  assert.deepEqual(createContentReport({ userId, novelId, category: "other", details: "", dailyLimit: 2 }), { ok: false, reason: "invalid" });
  assert.deepEqual(createContentReport({ userId: adminId, novelId, category: "spam", details: "", dailyLimit: 2 }), { ok: false, reason: "invalid" });
  assert.equal(createContentReport({ userId, novelId, category: "tag_error", details: "标签错误", dailyLimit: 2 }).ok, true);
  assert.equal(createContentReport({ userId, novelId, category: "hotword_error", details: "", dailyLimit: 2 }).ok, true);
  assert.deepEqual(createContentReport({ userId, novelId, category: "spam", details: "", dailyLimit: 2 }), { ok: false, reason: "limit" });

  const open = listContentReports({ status: "open", pageSize: 1 });
  assert.equal(open.totalReports, 2);
  assert.equal(open.totalPages, 2);
  assert.equal(open.reports[0].targetTitle, "测试小说");
  assert.equal(setContentReportStatus(open.reports[0].id, "resolved", "admin"), true);
  assert.equal(listContentReports({ status: "resolved" }).totalReports, 1);
  assert.equal(setContentReportStatus(open.reports[0].id, "open", "admin"), true);
  assert.equal(listContentReports({ status: "open" }).totalReports, 2);
  assert.equal(deleteContentReport(open.reports[0].id), true);
  assert.equal(listContentReports({ status: "all" }).totalReports, 1);
});

test("accepts video and audio reports while rejecting novel-only reasons", (t) => {
  withTempDatabase(t);
  const userId = createUserRecord({ username: "viewer", displayName: "Viewer", passwordHash: "hash", role: "user" });
  const insertMedia = getDb().prepare(
    `INSERT INTO media_assets
      (kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms)
     VALUES (?, ?, ?, ?, ?, 10, 1)`,
  );
  const videoId = Number(insertMedia
    .run("video", "测试视频", "test.mp4", "video/test.mp4", "video/mp4")
    .lastInsertRowid);
  const audioId = Number(insertMedia
    .run("audio", "测试音频", "test.mp3", "audio/test.mp3", "audio/mpeg")
    .lastInsertRowid);

  assert.deepEqual(
    createContentReport({ userId, mediaId: videoId, category: "tag_error", details: "", dailyLimit: 3 }),
    { ok: false, reason: "invalid" },
  );
  assert.equal(
    createContentReport({ userId, mediaId: videoId, category: "playback_error", details: "无法播放", dailyLimit: 3 }).ok,
    true,
  );
  assert.equal(
    createContentReport({ userId, mediaId: audioId, category: "spam", details: "音质异常", dailyLimit: 3 }).ok,
    true,
  );
  const reports = listContentReports({ status: "open" }).reports;
  assert.equal(reports[0].targetType, "media");
  assert.equal(reports[0].targetId, audioId);
  assert.equal(reports[0].targetTitle, "测试音频");
  assert.equal(reports[0].mediaKind, "audio");
  assert.equal(reports[1].targetId, videoId);
  assert.equal(reports[1].mediaKind, "video");
});
