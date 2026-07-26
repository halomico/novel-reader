import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  assignDefaultAvatarIfMissing,
  DEFAULT_AVATAR_PATHS,
  pickDefaultAvatar,
} from "./default-avatars";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-avatar-"));
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

test("default avatar picker stays inside the local avatar library", () => {
  assert.equal(pickDefaultAvatar(() => 0), DEFAULT_AVATAR_PATHS[0]);
  assert.equal(
    pickDefaultAvatar(() => DEFAULT_AVATAR_PATHS.length - 1),
    DEFAULT_AVATAR_PATHS.at(-1),
  );
});

test("login avatar assignment fills only an empty avatar", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('reader', '读者', 'hash')")
    .run().lastInsertRowid);

  const assigned = assignDefaultAvatarIfMissing(userId, null, () => 3);
  assert.equal(assigned, DEFAULT_AVATAR_PATHS[3]);
  assert.equal(assignDefaultAvatarIfMissing(userId, assigned, () => 7), assigned);

  db.prepare("UPDATE users SET avatar_path = '/avatars/custom.webp' WHERE id = ?").run(userId);
  assert.equal(
    assignDefaultAvatarIfMissing(userId, "/avatars/custom.webp", () => 1),
    "/avatars/custom.webp",
  );
});
