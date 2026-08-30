import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  buildTitleSearchSql,
  clearNovelSegmentCache,
  defaultNovelCatalogSortOrder,
  getAdjacentNovels,
  getNovelById,
  normalizeNovelAccessFilter,
  normalizeNovelCatalogSort,
  normalizeNovelCatalogSortOrder,
  normalizePageSize,
  planCatalogPage,
  readNovelSegments,
  type Novel,
} from "./books";
import { getDb } from "./db";
import { sampleNovelIdsFromList } from "./novel-id-sampler";
import { parseSearchQuery } from "./search-query";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-adjacent-"));
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

test("honors the configured catalog range up to 100 books", () => {
  assert.equal(normalizePageSize(75), 75);
  assert.equal(normalizePageSize(100), 100);
  assert.equal(normalizePageSize(101), 100);
});

test("keeps catalog sorting and access filters on their supported values", () => {
  assert.equal(normalizeNovelCatalogSort(undefined), "updated");
  assert.equal(normalizeNovelCatalogSort("name"), "name");
  assert.equal(normalizeNovelCatalogSort("words"), "words");
  assert.equal(normalizeNovelCatalogSort("random"), "updated");
  assert.equal(defaultNovelCatalogSortOrder("updated"), "desc");
  assert.equal(defaultNovelCatalogSortOrder("name"), "asc");
  assert.equal(defaultNovelCatalogSortOrder("words"), "desc");
  assert.equal(normalizeNovelCatalogSortOrder("asc", "updated"), "asc");
  assert.equal(normalizeNovelCatalogSortOrder("desc", "name"), "desc");
  assert.equal(normalizeNovelCatalogSortOrder("sideways", "words"), "desc");
  assert.equal(normalizeNovelAccessFilter(undefined), "all");
  assert.equal(normalizeNovelAccessFilter("free"), "free");
  assert.equal(normalizeNovelAccessFilter("soda"), "soda");
  assert.equal(normalizeNovelAccessFilter("paid"), "all");
});

test("resolves adjacent novels by the configured time or name order", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const defaultSource = db.prepare("SELECT id FROM novel_sources WHERE slug = 'default'").get() as { id: number };
  const otherSourceId = Number(
    db.prepare("INSERT INTO novel_sources (slug, name, relative_path) VALUES ('other', '其他来源', 'other')").run()
      .lastInsertRowid,
  );
  const insert = db.prepare(
    "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms, source_id) VALUES (?, ?, ?, 1, ?, ?)",
  );
  insert.run("Alpha", "alpha.txt", "alpha.txt", 100, defaultSource.id);
  const currentId = Number(insert.run("Bravo", "bravo.txt", "bravo.txt", 200, defaultSource.id).lastInsertRowid);
  insert.run("Charlie", "charlie.txt", "charlie.txt", 300, defaultSource.id);
  insert.run("Bravo Later", "bravo-later.txt", "bravo-later.txt", 200, defaultSource.id);
  insert.run("Other Source", "other-source.txt", "other/other-source.txt", 250, otherSourceId);
  const current = getNovelById(currentId);
  assert.ok(current);

  const byTime = getAdjacentNovels(current, "updated");
  assert.equal(byTime.previous?.title, "Bravo Later");
  assert.equal(byTime.next?.title, "Alpha");

  const byName = getAdjacentNovels(current, "name");
  assert.equal(byName.previous?.title, "Alpha");
  assert.equal(byName.next?.title, "Bravo Later");

  const index = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_novels_source_mtime_id'")
    .get() as { name: string } | undefined;
  assert.equal(index?.name, "idx_novels_source_mtime_id");

  const plans = [
    db.prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM novels
       WHERE (mtime_ms > ? OR (mtime_ms = ? AND id > ?)) AND source_id = ?
       ORDER BY mtime_ms ASC, id ASC LIMIT 1`,
    ).all(current.mtime_ms, current.mtime_ms, current.id, current.source_id),
    db.prepare(
      `EXPLAIN QUERY PLAN SELECT id FROM novels
       WHERE (mtime_ms < ? OR (mtime_ms = ? AND id < ?)) AND source_id = ?
       ORDER BY mtime_ms DESC, id DESC LIMIT 1`,
    ).all(current.mtime_ms, current.mtime_ms, current.id, current.source_id),
  ] as Array<Array<{ detail: string }>>;
  for (const plan of plans) {
    assert.equal(plan.some((row) => row.detail.includes("idx_novels_source_mtime_id")), true);
    assert.equal(plan.some((row) => row.detail.includes("TEMP B-TREE")), false);
  }
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

test("paginates promoted novels before the regular catalog without gaps", () => {
  const promotedIds = Array.from({ length: 20 }, (_, index) => index + 1);

  assert.deepEqual(planCatalogPage(promotedIds, 15, 0), {
    promotedIds: promotedIds.slice(0, 15),
    baseOffset: 0,
  });
  assert.deepEqual(planCatalogPage(promotedIds, 15, 15), {
    promotedIds: promotedIds.slice(15),
    baseOffset: 0,
  });
  assert.deepEqual(planCatalogPage(promotedIds, 15, 30), {
    promotedIds: [],
    baseOffset: 10,
  });
  assert.deepEqual(planCatalogPage([], 15, 15), {
    promotedIds: [],
    baseOffset: 15,
  });
});

test("reuses segmented content until the novel file version changes", async () => {
  const previousLibraryDir = process.env.NOVEL_LIBRARY_DIR;
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-segments-"));
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  clearNovelSegmentCache();

  const book: Novel = {
    id: 1,
    description: "",
    title: "缓存测试",
    file_name: "缓存测试.txt",
    relative_path: "缓存测试.txt",
    source_id: null,
    storage_mode: "single",
    chapter_count: 0,
    access_mode: "inherit",
    soda_price: 0,
    preview_chapter_count: 0,
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
    const [first, concurrent] = await Promise.all([
      readNovelSegments(book),
      readNovelSegments(book),
    ]);
    fs.writeFileSync(path.join(libraryDir, book.relative_path), "第二版正文", "utf8");
    const cached = await readNovelSegments(book);
    const refreshed = await readNovelSegments({ ...book, content_hash: "version-2", mtime_ms: 2 });

    assert.strictEqual(concurrent, first);
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
