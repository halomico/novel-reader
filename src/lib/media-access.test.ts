import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  getVideoDownloadAccess,
  getVideoPlaybackAccess,
  hasValidVideoDownloadSession,
  unlockVideoDownloadWithSoda,
  unlockVideoWithSoda,
  VIDEO_DOWNLOAD_SESSION_MS,
  VIDEO_DOWNLOAD_TICKET_MS,
  VIDEO_SODA_UNLOCK_MS,
} from "./media-access";
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

test("video soda grants last 24 hours and repeated unlocks are idempotent", (t) => {
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

test("video downloads use six-hour tickets and count each new session against the daily level limit", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db.prepare(
    "INSERT INTO users (username, display_name, password_hash, soda_balance) VALUES ('downloader', '下载者', 'hash', 3)",
  ).run().lastInsertRowid);
  const mediaId = Number(db.prepare(
    `INSERT INTO media_assets (
       kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms
     ) VALUES ('video', '下载视频', 'download.mp4', 'video/download.mp4', 'video/mp4', 100, 1)`,
  ).run().lastInsertRowid);
  const asset = getMediaAsset(mediaId)!;
  const day = 1_728_000_000_000;
  const now = day + 3_600_000;

  assert.equal(asset.downloadSodaPrice, 1);
  const first = unlockVideoDownloadWithSoda({ userId, mediaId, now });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.charged, true);
  assert.equal(first.sodaBalance, 2);
  assert.equal(first.ticketExpiresAt, now + VIDEO_DOWNLOAD_TICKET_MS);
  assert.equal(first.sessionExpiresAt, now + VIDEO_DOWNLOAD_SESSION_MS);
  assert.equal(hasValidVideoDownloadSession({ userId, mediaId, token: first.sessionToken, now: now + 1 }), true);
  assert.equal(hasValidVideoDownloadSession({ userId, mediaId, token: first.sessionToken, now: now + 2 }), true);
  assert.equal(getVideoDownloadAccess(asset, { id: userId, role: "user" }, now + 1).allowed, true);

  const second = unlockVideoDownloadWithSoda({ userId, mediaId, now: now + 1_000 });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.charged, false);
  assert.equal(second.sodaBalance, 2);
  assert.notEqual(second.sessionToken, first.sessionToken);

  const third = unlockVideoDownloadWithSoda({ userId, mediaId, now: now + 2_000 });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  assert.equal(third.charged, false);
  assert.deepEqual(unlockVideoDownloadWithSoda({ userId, mediaId, now: now + 3_000 }), {
    ok: false,
    reason: "daily_limit",
  });

  const nextDay = day + 86_400_000 + 3_600_000;
  assert.equal(getVideoDownloadAccess(asset, { id: userId, role: "user" }, nextDay).allowed, false);
  const renewed = unlockVideoDownloadWithSoda({ userId, mediaId, now: nextDay });
  assert.equal(renewed.ok, true);
  if (!renewed.ok) return;
  assert.equal(renewed.charged, true);
  assert.equal(renewed.sodaBalance, 1);
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE source = 'video_download'").get() as { count: number }).count,
    2,
  );
});
