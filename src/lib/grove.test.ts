import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import type { Novel } from "./books";
import { getDb } from "./db";
import {
  getMediaGroveState,
  getNovelGroveState,
  groveStageForVisitCount,
  listGrovePage,
  toggleMediaGrove,
  toggleNovelGrove,
} from "./grove";
import { recordReadingOpen } from "./reading-progress";
import { recordMediaHistory } from "./users";

function withTempDatabase(t: TestContext) {
  const previousPath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-grove-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("uses the seed, sprout, and tree visit thresholds", () => {
  assert.equal(groveStageForVisitCount(0), "seed");
  assert.equal(groveStageForVisitCount(2), "seed");
  assert.equal(groveStageForVisitCount(3), "sprout");
  assert.equal(groveStageForVisitCount(9), "sprout");
  assert.equal(groveStageForVisitCount(10), "tree");
});

test("counts visits after planting and resets after removal", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('grower', 'Grower', 'hash')")
    .run().lastInsertRowid);
  const novelId = Number(db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms, word_count)
     VALUES ('林中小说', 'grove.txt', 'grove.txt', 10, 1, 1000)`,
  ).run().lastInsertRowid);
  const book = db.prepare("SELECT * FROM novels WHERE id = ?").get(novelId) as Novel;

  assert.deepEqual(toggleNovelGrove(userId, novelId), {
    ok: true,
    planted: true,
    visitCount: 0,
    stage: "seed",
  });
  recordReadingOpen(userId, book);
  recordReadingOpen(userId, book);
  assert.equal(getNovelGroveState(userId, novelId).stage, "seed");
  recordReadingOpen(userId, book);
  assert.deepEqual(getNovelGroveState(userId, novelId), {
    planted: true,
    visitCount: 3,
    stage: "sprout",
  });

  assert.equal(toggleNovelGrove(userId, novelId).planted, false);
  assert.equal(toggleNovelGrove(userId, novelId).visitCount, 0);
  assert.deepEqual(getNovelGroveState(userId, novelId), {
    planted: true,
    visitCount: 0,
    stage: "seed",
  });
});

test("mixes novels, videos, and audio while excluding generic files", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('listener', 'Listener', 'hash')")
    .run().lastInsertRowid);
  const novelId = Number(db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms, word_count)
     VALUES ('回声小说', 'echo.txt', 'echo.txt', 10, 1, 2000)`,
  ).run().lastInsertRowid);
  const insertMedia = db.prepare(
    `INSERT INTO media_assets
      (kind, title, artist, file_name, stored_name, mime_type, size_bytes, mtime_ms, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, 10, 1, ?)`,
  );
  const videoId = Number(insertMedia
    .run("video", "回声视频", "", "echo.mp4", "video/echo.mp4", "video/mp4", 60)
    .lastInsertRowid);
  const audioId = Number(insertMedia
    .run("audio", "回声音频", "作者", "echo.mp3", "audio/echo.mp3", "audio/mpeg", 30)
    .lastInsertRowid);
  const fileId = Number(insertMedia
    .run("file", "回声文件", "", "echo.zip", "file/echo.zip", "application/zip", null)
    .lastInsertRowid);

  assert.equal(toggleNovelGrove(userId, novelId).planted, true);
  assert.equal(toggleMediaGrove(userId, videoId).planted, true);
  assert.equal(toggleMediaGrove(userId, audioId).planted, true);
  assert.deepEqual(toggleMediaGrove(userId, fileId), {
    ok: false,
    planted: false,
    visitCount: 0,
    stage: "seed",
  });
  for (let visit = 0; visit < 10; visit += 1) {
    recordMediaHistory(userId, { id: videoId, kind: "video", title: "回声视频" });
  }
  for (let visit = 0; visit < 3; visit += 1) {
    recordMediaHistory(userId, { id: audioId, kind: "audio", title: "回声音频" });
  }

  assert.equal(getMediaGroveState(userId, videoId).stage, "tree");
  assert.equal(getMediaGroveState(userId, audioId).stage, "sprout");
  const all = listGrovePage(userId);
  assert.equal(all.totalItems, 3);
  assert.deepEqual(all.stats, { all: 3, seed: 1, sprout: 1, tree: 1 });
  assert.deepEqual(listGrovePage(userId, { stage: "tree" }).items.map((item) => item.id), [videoId]);
  assert.deepEqual(
    listGrovePage(userId, { allowedKinds: ["audio"] }).items.map((item) => item.kind),
    ["audio"],
  );
  assert.equal(listGrovePage(userId, { allowedKinds: [] }).totalItems, 0);
});
