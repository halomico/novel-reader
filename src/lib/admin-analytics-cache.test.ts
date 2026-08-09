import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ADMIN_ANALYTICS_CACHE_TTL_MS,
  getCachedAdminAnalyticsSummary,
  getCachedAdminRealtimeCountries,
} from "./admin-analytics-cache";
import { getAnalyticsRealtimeActivity } from "./analytics";
import { getDb } from "./db";

type AnalyticsCacheTestState = typeof globalThis & {
  novelReaderDb?: DatabaseSync;
  novelReaderAdminAnalyticsCache?: unknown;
};

test("caches aggregate analytics briefly without making realtime visits stale", (t) => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-admin-analytics-cache-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "settings.json");
  const state = globalThis as AnalyticsCacheTestState;
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  delete state.novelReaderAdminAnalyticsCache;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    delete state.novelReaderAdminAnalyticsCache;
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
  const insertEvent = db.prepare(
    "INSERT INTO analytics_events (event_type, path, ip, country, novel_id) VALUES ('novel_view', '/books/1', ?, 'CN', ?)",
  );
  insertEvent.run("test-client-1", novelId);

  const startedAt = 1_000;
  assert.equal(getCachedAdminAnalyticsSummary("24h", {}, startedAt).totalViews, 1);
  assert.deepEqual(getCachedAdminRealtimeCountries("24h", {}, startedAt), ["CN"]);
  db.prepare(
    "INSERT INTO analytics_events (event_type, path, ip, country, novel_id) VALUES ('novel_view', '/books/1', ?, 'US', ?)",
  ).run("test-client-2", novelId);

  assert.equal(getCachedAdminAnalyticsSummary("24h", {}, startedAt + 1).totalViews, 1);
  assert.deepEqual(getCachedAdminRealtimeCountries("24h", {}, startedAt + 1), ["CN"]);
  assert.equal(getAnalyticsRealtimeActivity("24h").realtimeTotal, 2);
  assert.equal(
    getCachedAdminAnalyticsSummary("24h", {}, startedAt + ADMIN_ANALYTICS_CACHE_TTL_MS).totalViews,
    2,
  );
  assert.deepEqual(
    getCachedAdminRealtimeCountries("24h", {}, startedAt + ADMIN_ANALYTICS_CACHE_TTL_MS),
    ["CN", "US"],
  );
});
