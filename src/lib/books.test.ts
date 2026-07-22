import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { buildTitleSearchSql, clearNovelSegmentCache, normalizePageSize, readNovelSegments, type Novel } from "./books";
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

test("reuses segmented content until the novel file version changes", async () => {
  const previousLibraryDir = process.env.NOVEL_LIBRARY_DIR;
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-segments-"));
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  clearNovelSegmentCache();

  const book: Novel = {
    id: 1,
    title: "缓存测试",
    file_name: "缓存测试.txt",
    relative_path: "缓存测试.txt",
    content_hash: "version-1",
    size_bytes: 12,
    mtime_ms: 1,
    word_count: 12,
    visit_count: 0,
    last_accessed_at: null,
    last_accessed_ip: null,
    last_accessed_user_agent: null,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
  };

  try {
    fs.writeFileSync(path.join(libraryDir, book.relative_path), "第一版正文", "utf8");
    const first = await readNovelSegments(book);
    fs.writeFileSync(path.join(libraryDir, book.relative_path), "第二版正文", "utf8");
    const cached = await readNovelSegments(book);
    const refreshed = await readNovelSegments({ ...book, content_hash: "version-2", mtime_ms: 2 });

    assert.strictEqual(cached, first);
    assert.equal(first[0]?.content, "第一版正文");
    assert.notStrictEqual(refreshed, first);
    assert.equal(refreshed[0]?.content, "第二版正文");
  } finally {
    clearNovelSegmentCache();
    if (previousLibraryDir === undefined) {
      delete process.env.NOVEL_LIBRARY_DIR;
    } else {
      process.env.NOVEL_LIBRARY_DIR = previousLibraryDir;
    }
    fs.rmSync(libraryDir, { recursive: true, force: true });
  }
});
