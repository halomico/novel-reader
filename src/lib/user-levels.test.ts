import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  getUserLevelDefinition,
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
  assert.equal(getUserLevelDefinition(0).permissions.includes("novel_feedback"), true);

  assert.equal(saveUserLevelDefinition({
    level: 0,
    name: "访客成员",
    permissions: ["content_report"],
  }), true);
  assert.equal(getUserLevelDefinition(0).name, "访客成员");
  assert.equal(hasUserPermission({ role: "user", trustLevel: 0 }, "content_report"), true);
  assert.equal(hasUserPermission({ role: "user", trustLevel: 0 }, "novel_feedback"), false);
  assert.equal(hasUserPermission({ role: "admin", trustLevel: 0 }, "novel_feedback"), true);
});
