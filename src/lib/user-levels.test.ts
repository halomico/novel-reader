import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  getUserGrowthProgress,
  getUserLevelDefinition,
  getUserLevelForExperience,
  hasUserPermission,
  listUserLevelDefinitions,
  saveUserLevelDefinition,
} from "./user-levels";

function withTempDatabase(t: TestContext): string {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-levels-"));
  const databasePath = path.join(root, "novels.db");
  process.env.DATABASE_PATH = databasePath;
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
  return databasePath;
}

test("stores seven configurable frontend levels and enforces their permissions", (t) => {
  withTempDatabase(t);
  getDb();
  assert.equal(listUserLevelDefinitions().length, 7);
  assert.deepEqual(getUserLevelDefinition(0).permissions, []);
  assert.equal(getUserLevelDefinition(1).permissions.includes("advanced_search"), false);
  assert.equal(getUserLevelDefinition(1).permissions.includes("video_download"), true);
  assert.equal(getUserLevelDefinition(1).dailyVideoDownloadLimit, 3);
  assert.equal(getUserLevelForExperience(0), 1);
  assert.equal(getUserLevelForExperience(49), 1);
  assert.equal(getUserLevelForExperience(50), 2);

  assert.equal(saveUserLevelDefinition({
    level: 2,
    name: "进阶成员",
    sodaRequired: 75,
    dailyVideoDownloadLimit: 9,
    permissions: ["advanced_search", "content_report", "video_download"],
  }), true);
  assert.equal(getUserLevelDefinition(2).name, "进阶成员");
  assert.equal(getUserLevelDefinition(2).sodaRequired, 75);
  assert.equal(getUserLevelDefinition(2).dailyVideoDownloadLimit, 9);
  assert.equal(getUserLevelForExperience(74), 1);
  assert.equal(getUserLevelForExperience(75), 2);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "content_report"), true);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "novel_feedback"), true);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "advanced_search"), true);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "video_download"), true);
  assert.equal(hasUserPermission({ role: "admin", trustLevel: 0 }, "novel_feedback"), true);

  const progress = getUserGrowthProgress(100);
  assert.equal(progress.current.level, 2);
  assert.equal(progress.next?.level, 3);
  assert.equal(progress.targetValue, 200);
  assert.equal(progress.progress, 20);
});

test("keeps legacy level-zero permissions valid while adding download limits", (t) => {
  const databasePath = withTempDatabase(t);
  const legacy = new DatabaseSync(databasePath);
  legacy.exec(`
    CREATE TABLE app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE user_levels (
      level INTEGER PRIMARY KEY CHECK(level BETWEEN 0 AND 6),
      name TEXT NOT NULL,
      soda_required INTEGER NOT NULL DEFAULT 0,
      permissions TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO user_levels (level, name, soda_required, permissions)
    VALUES (0, '访客', 0, '["content_report","station_message"]');
  `);
  legacy.close();

  getDb();
  assert.deepEqual(getUserLevelDefinition(0).permissions, []);
  assert.equal(getUserLevelDefinition(0).dailyVideoDownloadLimit, 0);
});
