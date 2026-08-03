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

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-levels-"));
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

test("stores seven configurable frontend levels and enforces their permissions", (t) => {
  withTempDatabase(t);
  getDb();
  assert.equal(listUserLevelDefinitions().length, 7);
  assert.deepEqual(getUserLevelDefinition(0).permissions, []);
  assert.equal(getUserLevelDefinition(1).permissions.includes("advanced_search"), false);
  assert.equal(getUserLevelForExperience(0), 1);
  assert.equal(getUserLevelForExperience(49), 1);
  assert.equal(getUserLevelForExperience(50), 2);

  assert.equal(saveUserLevelDefinition({
    level: 2,
    name: "进阶成员",
    sodaRequired: 75,
    permissions: ["advanced_search", "content_report"],
  }), true);
  assert.equal(getUserLevelDefinition(2).name, "进阶成员");
  assert.equal(getUserLevelDefinition(2).sodaRequired, 75);
  assert.equal(getUserLevelForExperience(74), 1);
  assert.equal(getUserLevelForExperience(75), 2);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "content_report"), true);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "novel_feedback"), true);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 2 }, "advanced_search"), true);
  assert.equal(hasUserPermission({ role: "admin", trustLevel: 0 }, "novel_feedback"), true);

  const progress = getUserGrowthProgress(100);
  assert.equal(progress.current.level, 2);
  assert.equal(progress.next?.level, 3);
  assert.equal(progress.targetValue, 200);
  assert.equal(progress.progress, 20);
});
