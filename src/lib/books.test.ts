import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildTitleSearchSql, normalizePageSize } from "./books";
import { sampleNovelIdsFromList } from "./novel-id-sampler";
import { parseSearchQuery } from "./search-query";

test("honors the configured catalog range up to 100 books", () => {
  assert.equal(normalizePageSize(75), 75);
  assert.equal(normalizePageSize(100), 100);
  assert.equal(normalizePageSize(101), 100);
});

test("pushes compound title matching into SQLite", () => {
  const validation = parseSearchQuery("修仙 AND 系统 NOT 末日", { mode: "title" });
  assert.equal(validation.ok, true);
  if (!validation.ok) return;

  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE novels (title TEXT NOT NULL); INSERT INTO novels VALUES ('修仙系统'), ('末日修仙系统'), ('修仙日常'), ('科幻系统');");
    const search = buildTitleSearchSql(validation.query);
    const rows = db.prepare(`SELECT title FROM novels WHERE ${search.whereSql} ORDER BY title`).all(...search.values) as Array<{ title: string }>;
    assert.deepEqual(rows.map((row) => row.title), ["修仙系统"]);
  } finally {
    db.close();
  }
});

test("samples sparse novel IDs uniformly without depending on ID gaps", () => {
  const ids = [1, 2, 50_000, 900_000, 2_000_000];
  const first = sampleNovelIdsFromList(ids, 4, "stable-seed");
  const repeated = sampleNovelIdsFromList(ids, 4, "stable-seed");
  const excluded = sampleNovelIdsFromList(ids, 4, "stable-seed", new Set([2, 900_000]));

  assert.deepEqual(first, repeated);
  assert.equal(first.length, 4);
  assert.equal(new Set(first).size, 4);
  assert.equal(first.every((id) => ids.includes(id)), true);
  assert.equal(excluded.some((id) => id === 2 || id === 900_000), false);
  assert.equal(excluded.length, 3);
});
