import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { getNovelRecommendationState, recommendNovelWithSoda } from "./recommendations";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-recommendation-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("charges soda once per novel and site day", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash, soda_balance) VALUES ('reader', '读者', 'hash', 4)")
    .run().lastInsertRowid);
  const novelId = Number(db
    .prepare(
      "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES ('测试', 'test.txt', 'test.txt', 1, 1)",
    )
    .run().lastInsertRowid);
  const otherNovelId = Number(db
    .prepare(
      "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES ('测试二', 'test-2.txt', 'test-2.txt', 1, 1)",
    )
    .run().lastInsertRowid);
  const firstDay = new Date("2026-07-26T04:00:00.000Z");
  const secondDay = new Date("2026-07-27T04:00:00.000Z");

  const first = recommendNovelWithSoda(userId, novelId, 1, firstDay);
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.alreadyRecommended, false);
  assert.equal(first.ok && first.count, 1);
  assert.equal(first.ok && first.sodaBalance, 3);

  const duplicate = recommendNovelWithSoda(userId, novelId, 1, firstDay);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.ok && duplicate.alreadyRecommended, true);
  assert.equal(duplicate.ok && duplicate.count, 1);
  assert.equal(duplicate.ok && duplicate.sodaBalance, 3);

  const other = recommendNovelWithSoda(userId, otherNovelId, 1, firstDay);
  assert.equal(other.ok, true);
  assert.equal(other.ok && other.sodaBalance, 2);

  const nextDay = recommendNovelWithSoda(userId, novelId, 1, secondDay);
  assert.equal(nextDay.ok, true);
  assert.equal(nextDay.ok && nextDay.alreadyRecommended, false);
  assert.equal(nextDay.ok && nextDay.count, 2);
  assert.equal(nextDay.ok && nextDay.sodaBalance, 1);

  assert.deepEqual(getNovelRecommendationState(userId, novelId, secondDay), {
    recommended: true,
    count: 2,
    sodaBalance: 1,
  });
  assert.deepEqual(recommendNovelWithSoda(0, novelId, 1, secondDay), { ok: false, reason: "invalid" });
});
