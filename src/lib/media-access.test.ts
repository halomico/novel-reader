import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { getVideoPlaybackAccess, unlockVideoWithSoda, VIDEO_SODA_UNLOCK_MS } from "./media-access";
import { getMediaAsset } from "./media";

function withTempDatabase(t: TestContext) {
  const previous = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-media-access-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("video soda grants last three hours and repeated unlocks are idempotent", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db.prepare(
    "INSERT INTO users (username, display_name, password_hash, soda_balance) VALUES ('viewer', '观看者', 'hash', 10)",
  ).run().lastInsertRowid);
  const mediaId = Number(db.prepare(
    `INSERT INTO media_assets (
       kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms, play_soda_price
     ) VALUES ('video', '测试视频', 'test.mp4', 'video/test.mp4', 'video/mp4', 100, 1, 3)`,
  ).run().lastInsertRowid);
  const asset = getMediaAsset(mediaId)!;
  const now = 1_000_000;

  assert.equal(getVideoPlaybackAccess(asset, null, now).reason, "login_required");
  assert.equal(getVideoPlaybackAccess(asset, { id: userId, role: "user" }, now).allowed, false);

  assert.deepEqual(unlockVideoWithSoda({ userId, mediaId, now }), {
    ok: true,
    charged: true,
    sodaBalance: 7,
    expiresAt: now + VIDEO_SODA_UNLOCK_MS,
  });
  assert.equal(getVideoPlaybackAccess(asset, { id: userId, role: "user" }, now).allowed, true);
  assert.deepEqual(unlockVideoWithSoda({ userId, mediaId, now: now + 1_000 }), {
    ok: true,
    charged: false,
    sodaBalance: 7,
    expiresAt: now + VIDEO_SODA_UNLOCK_MS,
  });
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source = 'video_unlock'").get() as { count: number }).count,
    1,
  );

  assert.deepEqual(unlockVideoWithSoda({ userId, mediaId, now: now + VIDEO_SODA_UNLOCK_MS + 1 }), {
    ok: true,
    charged: true,
    sodaBalance: 4,
    expiresAt: now + VIDEO_SODA_UNLOCK_MS * 2 + 1,
  });
});
