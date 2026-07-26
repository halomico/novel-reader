import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { isNovelFavorite, listFavoriteNovels, toggleNovelFavorite } from "./favorites";

function withTempDatabase(t: TestContext) {
  const previousPath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-favorites-"));
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

test("toggles and paginates favorites per user", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const firstUser = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('first', 'First', 'hash')")
    .run().lastInsertRowid);
  const secondUser = Number(db
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('second', 'Second', 'hash')")
    .run().lastInsertRowid);
  const insertNovel = db.prepare(
    "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES (?, ?, ?, 10, 1)",
  );
  const firstNovel = Number(insertNovel.run("第一本", "one.txt", "one.txt").lastInsertRowid);
  const secondNovel = Number(insertNovel.run("第二本", "two.txt", "two.txt").lastInsertRowid);

  assert.deepEqual(toggleNovelFavorite(firstUser, firstNovel), { ok: true, favorite: true });
  assert.deepEqual(toggleNovelFavorite(firstUser, secondNovel), { ok: true, favorite: true });
  assert.equal(isNovelFavorite(firstUser, firstNovel), true);
  assert.equal(isNovelFavorite(secondUser, firstNovel), false);
  assert.deepEqual(listFavoriteNovels(firstUser, 1, 1).books.map((book) => book.id), [secondNovel]);
  assert.deepEqual(toggleNovelFavorite(firstUser, firstNovel), { ok: true, favorite: false });
  assert.equal(listFavoriteNovels(firstUser).totalBooks, 1);
  assert.deepEqual(toggleNovelFavorite(firstUser, 999), { ok: false, favorite: false });
});
