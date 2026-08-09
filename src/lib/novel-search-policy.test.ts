import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  getNovelSourceSearchMode,
  listFullTextSearchNovelIds,
  removeNovelSourceSearchMode,
  setNovelSourceSearchMode,
} from "./novel-search-policy";

test("keeps full-text search as the default and excludes book-only sources", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-search-policy-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE novel_sources (id INTEGER PRIMARY KEY, slug TEXT NOT NULL);
    CREATE TABLE novels (id INTEGER PRIMARY KEY, source_id INTEGER);
    INSERT INTO novel_sources (id, slug) VALUES (1, 'default'), (2, 'large-library');
    INSERT INTO novels (id, source_id) VALUES (1, 1), (2, 2), (3, NULL);
  `);

  try {
    assert.equal(getNovelSourceSearchMode("large-library"), "full");
    assert.deepEqual(listFullTextSearchNovelIds(db), [1, 2, 3]);

    setNovelSourceSearchMode("Large-Library", "book");
    assert.equal(getNovelSourceSearchMode("large-library"), "book");
    assert.deepEqual(listFullTextSearchNovelIds(db), [1, 3]);

    removeNovelSourceSearchMode("large-library");
    assert.equal(getNovelSourceSearchMode("large-library"), "full");
    assert.deepEqual(listFullTextSearchNovelIds(db), [1, 2, 3]);
  } finally {
    db.close();
    if (previousPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
