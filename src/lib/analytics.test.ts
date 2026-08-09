import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  getAnalyticsOverview,
  normalizeAnalyticsRange,
  normalizeAnalyticsRealtimeContentFilter,
  normalizeAnalyticsRealtimeCountry,
  parseUserAgent,
} from "./analytics";
import { getDb } from "./db";

type AnalyticsTestState = typeof globalThis & {
  novelReaderDb?: DatabaseSync;
};

test("normalizes analytics ranges", () => {
  assert.equal(normalizeAnalyticsRange("24h"), "24h");
  assert.equal(normalizeAnalyticsRange("7d"), "7d");
  assert.equal(normalizeAnalyticsRange("30d"), "30d");
  assert.equal(normalizeAnalyticsRange("custom"), "custom");
  assert.equal(normalizeAnalyticsRange("90d"), "24h");
});

test("normalizes realtime analytics filters", () => {
  assert.equal(normalizeAnalyticsRealtimeContentFilter("video"), "video");
  assert.equal(normalizeAnalyticsRealtimeContentFilter("other"), "all");
  assert.equal(normalizeAnalyticsRealtimeCountry(" cn "), "CN");
  assert.equal(normalizeAnalyticsRealtimeCountry("unknown"), "unknown");
  assert.equal(normalizeAnalyticsRealtimeCountry("not-a-country"), "all");
});

test("parses common desktop browser user agents", () => {
  const result = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.1 Safari/537.36",
  );
  assert.deepEqual(result, {
    device: "desktop",
    browser: "chrome",
    os: "windows",
  });
});

test("parses mobile user agents", () => {
  const result = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  );
  assert.deepEqual(result, {
    device: "mobile",
    browser: "safari",
    os: "ios",
  });
});

test("filters realtime visits before counting and pagination", (t) => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-analytics-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");
  const state = globalThis as AnalyticsTestState;
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const db = getDb();
  const novelId = Number(db.prepare(
    "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES ('Novel', 'n.txt', 'n.txt', 1, 1)",
  ).run().lastInsertRowid);
  const addMedia = db.prepare(
    "INSERT INTO media_assets (kind, title, file_name, stored_name, mime_type, size_bytes) VALUES (?, ?, ?, ?, ?, 1)",
  );
  const videoId = Number(addMedia.run("video", "Video", "v.mp4", "v.mp4", "video/mp4").lastInsertRowid);
  const audioId = Number(addMedia.run("audio", "Audio", "a.mp3", "a.mp3", "audio/mpeg").lastInsertRowid);
  const insertEvent = db.prepare(
    `INSERT INTO analytics_events
      (event_type, path, ip, country, novel_id, media_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  insertEvent.run("novel_view", "/books/1", "test-client-1", "CN", novelId, null);
  insertEvent.run("video_view", "/media/1", "test-client-2", "US", null, videoId);
  insertEvent.run("audio_view", "/media/2", "test-client-3", "CN", null, audioId);
  insertEvent.run("video_view", "/media/1", "test-client-4", "unknown", null, videoId);

  const video = getAnalyticsOverview("24h", { realtimeContentType: "video", realtimePageSize: 1 });
  assert.equal(video.realtimeTotal, 2);
  assert.equal(video.realtime[0]?.contentType, "video");
  assert.deepEqual(video.realtimeCountries, ["US", "unknown"]);

  const cn = getAnalyticsOverview("24h", { realtimeCountry: "cn" });
  assert.equal(cn.realtimeTotal, 2);
  assert.ok(cn.realtime.every((event) => event.country === "CN"));

  const unknown = getAnalyticsOverview("24h", { realtimeCountry: "UNKNOWN" });
  assert.equal(unknown.realtimeTotal, 1);
  assert.equal(unknown.realtime[0]?.country, "unknown");
});
