import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  getMediaRecommendationState,
  getNovelRecommendationState,
  recommendMediaWithSoda,
  recommendNovelWithSoda,
} from "./recommendations";

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

test("charges soda once per user and novel without a daily reset", (t) => {
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
  assert.equal(nextDay.ok && nextDay.alreadyRecommended, true);
  assert.equal(nextDay.ok && nextDay.count, 1);
  assert.equal(nextDay.ok && nextDay.sodaBalance, 2);

  assert.deepEqual(getNovelRecommendationState(userId, novelId, secondDay), {
    recommended: true,
    count: 1,
    sodaBalance: 2,
  });
  assert.deepEqual(recommendNovelWithSoda(0, novelId, 1, secondDay), { ok: false, reason: "invalid" });
});

test("charges soda once per user and media asset without a daily reset", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash, soda_balance) VALUES ('viewer', '观众', 'hash', 4)")
    .run().lastInsertRowid);
  const insertMedia = db.prepare(
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
  const firstDay = new Date("2026-07-26T04:00:00.000Z");
  const secondDay = new Date("2026-07-27T04:00:00.000Z");

  const first = recommendMediaWithSoda(userId, videoId, 1, firstDay);
  assert.equal(first.ok && first.count, 1);
  assert.equal(first.ok && first.sodaBalance, 3);
  const audio = recommendMediaWithSoda(userId, audioId, 1, firstDay);
  assert.equal(audio.ok && audio.count, 1);
  assert.equal(audio.ok && audio.sodaBalance, 2);
  assert.equal(recommendMediaWithSoda(userId, audioId, 1, firstDay).ok, true);
  const nextDay = recommendMediaWithSoda(userId, audioId, 1, secondDay);
  assert.equal(nextDay.ok && nextDay.alreadyRecommended, true);
  assert.equal(nextDay.ok && nextDay.count, 1);
  assert.deepEqual(getMediaRecommendationState(userId, audioId, secondDay), {
    recommended: true,
    count: 1,
    sodaBalance: 2,
  });
});
