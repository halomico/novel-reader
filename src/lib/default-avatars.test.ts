import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  assignDefaultAvatarIfMissing,
  pickDefaultAvatar,
} from "./default-avatars";
import {
  generatedAvatarPath,
  generatedAvatarSeed,
  generatedAvatarUrl,
  isGeneratedAvatarPath,
  isGeneratedDefaultAvatar,
} from "./default-avatar-data";
import { renderGeneratedAvatarSvg } from "./generated-avatar";

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

test("default avatar picker stores a full random seed instead of a fixed catalogue", () => {
  const marker = pickDefaultAvatar(() => Buffer.from("0123456789abcdef", "hex"));
  assert.equal(marker, "generated-avatar:0123456789abcdef");
  assert.equal(isGeneratedAvatarPath(marker), true);
  assert.equal(isGeneratedAvatarPath("generated-avatar:not-safe"), false);
  assert.throws(() => generatedAvatarPath("../widget"), /Invalid generated avatar seed/);
});

test("generated avatars are stable SVG combinations and remap legacy defaults", () => {
  const first = renderGeneratedAvatarSvg("11-0123456789abcdef");
  assert.equal(first, renderGeneratedAvatarSvg("11-0123456789abcdef"));
  assert.notEqual(first, renderGeneratedAvatarSvg("11-fedcba9876543210"));
  assert.match(first, /vue-color-avatar-face/);
  assert.match(first, /vue-color-avatar-(tops|eyes|mouth)/);
  assert.doesNotMatch(first, /\$fillColor/);
  assert.equal(generatedAvatarUrl(11, "generated-avatar:0123456789abcdef"), "/api/avatars/11-0123456789abcdef.svg");
  assert.equal(generatedAvatarUrl(11, "default-avatar:3"), "/api/avatars/11-3.svg");
  assert.equal(generatedAvatarUrl(11, "/default-avatars/04.svg"), "/api/avatars/11-3.svg");
  assert.equal(generatedAvatarSeed(11, null), "b");
  assert.equal(isGeneratedDefaultAvatar("/avatars/custom.webp"), false);
});

test("login avatar assignment fills only an empty avatar", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const userId = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('reader', '读者', 'hash')")
    .run().lastInsertRowid);

  const assigned = assignDefaultAvatarIfMissing(userId, null, () => Buffer.from("1122334455667788", "hex"));
  assert.equal(assigned, "generated-avatar:1122334455667788");
  assert.equal(
    assignDefaultAvatarIfMissing(userId, assigned, () => Buffer.from("8877665544332211", "hex")),
    assigned,
  );

  db.prepare("UPDATE users SET avatar_path = '/avatars/custom.webp' WHERE id = ?").run(userId);
  assert.equal(
    assignDefaultAvatarIfMissing(userId, "/avatars/custom.webp", () => Buffer.from("aabbccddeeff0011", "hex")),
    "/avatars/custom.webp",
  );
});
