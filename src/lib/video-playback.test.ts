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

test("video playback leases enforce concurrency, stable clients, capacity, heartbeat, and expiry", (t) => {
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
  const viewerKey = `user:${userId}`;
  const first = createVideoPlaybackLease({
    viewerKey,
    userId,
    clientId: "client_first_123456",
    mediaId: firstVideo,
    limit: 1,
    now,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(validateVideoPlaybackLease({
    id: first.lease.id,
    token: first.lease.token,
    viewerKey,
    mediaId: firstVideo,
    now,
  }), true);
  assert.deepEqual(
    createVideoPlaybackLease({
      viewerKey,
      userId,
      clientId: "client_second_123456",
      mediaId: secondVideo,
      limit: 1,
      now,
    }),
    { ok: false, reason: "limit_reached", limit: 1 },
  );
  assert.equal(refreshVideoPlaybackLease({
    id: first.lease.id,
    token: first.lease.token,
    viewerKey,
    mediaId: firstVideo,
    now: now + 25_000,
  }), now + 115_000);
  assert.equal(releaseVideoPlaybackLease({
    id: first.lease.id,
    token: first.lease.token,
    viewerKey,
    mediaId: firstVideo,
  }), true);
  assert.equal(createVideoPlaybackLease({
    viewerKey,
    userId,
    clientId: "client_second_123456",
    mediaId: secondVideo,
    limit: 1,
    now,
  }).ok, true);

  const expiring = createVideoPlaybackLease({
    viewerKey,
    userId,
    clientId: "client_expiring_1234",
    mediaId: firstVideo,
    limit: 2,
    now,
  });
  assert.equal(expiring.ok, true);
  if (!expiring.ok) return;
  assert.equal(validateVideoPlaybackLease({
    id: expiring.lease.id,
    token: expiring.lease.token,
    viewerKey,
    mediaId: firstVideo,
    now: now + 90_001,
  }), false);

  const reused = createVideoPlaybackLease({
    viewerKey,
    userId,
    clientId: "client_second_123456",
    mediaId: firstVideo,
    limit: 2,
    now,
  });
  assert.equal(reused.ok, true);

  const guest = createVideoPlaybackLease({
    viewerKey: "guest:abcdefghijklmnopqrstuvwxyz123456",
    clientId: "guest_client_123456",
    mediaId: firstVideo,
    limit: 1,
    storageNodeId: "video-node",
    reservedKbps: 2_000,
    nodeMaxStreams: 1,
    now: now + 100_000,
  });
  assert.equal(guest.ok, true);
  assert.deepEqual(createVideoPlaybackLease({
    viewerKey: "guest:zyxwvutsrqponmlkjihgfedcba654321",
    clientId: "guest_client_654321",
    mediaId: secondVideo,
    limit: 1,
    storageNodeId: "video-node",
    reservedKbps: 2_000,
    nodeMaxStreams: 1,
    now: now + 100_000,
  }), { ok: false, reason: "node_busy" });
});
