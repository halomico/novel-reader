import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  createVideoPlaybackLease,
  refreshVideoPlaybackLease,
  releaseVideoPlaybackLease,
  validateVideoPlaybackLease,
} from "./video-playback";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-playback-"));
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

test("video playback leases enforce concurrency, heartbeat, expiry, and release", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('viewer', '观看者', 'hash')")
    .run().lastInsertRowid);
  const insertMedia = db.prepare(
    `INSERT INTO media_assets (
       kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms
     )
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const firstVideo = Number(insertMedia
    .run("video", "视频一", "one.mp4", "video/one.mp4", "video/mp4", 100, 1)
    .lastInsertRowid);
  const secondVideo = Number(insertMedia
    .run("video", "视频二", "two.mp4", "video/two.mp4", "video/mp4", 100, 1)
    .lastInsertRowid);
  const now = Date.now();
  const first = createVideoPlaybackLease({ userId, mediaId: firstVideo, limit: 1, now });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(validateVideoPlaybackLease({
    id: first.lease.id,
    token: first.lease.token,
    userId,
    mediaId: firstVideo,
    now,
  }), true);
  assert.deepEqual(
    createVideoPlaybackLease({ userId, mediaId: secondVideo, limit: 1, now }),
    { ok: false, reason: "limit_reached", limit: 1 },
  );
  assert.equal(refreshVideoPlaybackLease({
    id: first.lease.id,
    token: first.lease.token,
    userId,
    mediaId: firstVideo,
    now: now + 25_000,
  }), now + 115_000);
  assert.equal(releaseVideoPlaybackLease({
    id: first.lease.id,
    token: first.lease.token,
    userId,
    mediaId: firstVideo,
  }), true);
  assert.equal(createVideoPlaybackLease({ userId, mediaId: secondVideo, limit: 1, now }).ok, true);

  const expiring = createVideoPlaybackLease({ userId, mediaId: firstVideo, limit: 2, now });
  assert.equal(expiring.ok, true);
  if (!expiring.ok) return;
  assert.equal(validateVideoPlaybackLease({
    id: expiring.lease.id,
    token: expiring.lease.token,
    userId,
    mediaId: firstVideo,
    now: now + 90_001,
  }), false);
});
