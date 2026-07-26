import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  filterTagsForUser,
  listEffectivelyHiddenTagIds,
  listExplicitlyHiddenTagIds,
  setUserTagHidden,
} from "./tag-preferences";
import { createTag } from "./tags";

function withTempDatabase(t: TestContext) {
  const previousPath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-tag-preferences-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("hiding a tag group hides descendants only for that user", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const firstUser = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('first', 'First', 'hash')")
    .run().lastInsertRowid);
  const secondUser = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('second', 'Second', 'hash')")
    .run().lastInsertRowid);
  const group = createTag({ name: "题材", slug: "topic" });
  const child = createTag({ name: "奇幻", slug: "fantasy", parentId: group.id });

  assert.equal(setUserTagHidden(firstUser, group.id, true), true);
  assert.deepEqual([...listExplicitlyHiddenTagIds(firstUser)], [group.id]);
  assert.deepEqual([...listEffectivelyHiddenTagIds(firstUser)].sort((a, b) => a - b), [group.id, child.id]);
  assert.deepEqual(filterTagsForUser([child], firstUser), []);
  assert.deepEqual(filterTagsForUser([child], secondUser).map((tag) => tag.id), [child.id]);
  assert.equal(setUserTagHidden(firstUser, group.id, false), true);
  assert.deepEqual([...listEffectivelyHiddenTagIds(firstUser)], []);
  assert.equal(setUserTagHidden(firstUser, 999, true), false);
});
