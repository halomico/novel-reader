import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { createContentReport, listContentReports, setContentReportStatus } from "./reports";
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
  assert.equal(open.reports[0].novelTitle, "测试小说");
  assert.equal(setContentReportStatus(open.reports[0].id, "resolved", "admin"), true);
  assert.equal(listContentReports({ status: "resolved" }).totalReports, 1);
  assert.equal(setContentReportStatus(open.reports[0].id, "open", "admin"), true);
  assert.equal(listContentReports({ status: "open" }).totalReports, 2);
});
