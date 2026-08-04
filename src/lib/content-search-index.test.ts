import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { Novel } from "./books";
import {
  closeAllContentSearchDbs,
  deleteContentSearchDatabase,
  getContentSearchDatabasePathForSource,
  getContentSearchDb,
  getLegacyContentSearchDb,
  initializeContentSearchDb,
} from "./content-search-db";
import {
  buildContentSearchIndex,
  clearContentSearchIndex,
  CONTENT_SEARCH_INDEX_VERSION,
  createBigramTokenDocument,
  deleteContentSearchIndexNovel,
  findContentSearchCandidateNovelIds,
  getContentSearchIndexSummary,
} from "./content-search-index";
import { normalizeSearchText } from "./search-query";
import { buildContentSearchSourceIndex } from "./content-search-sources";

function novel(id: number, overrides: Partial<Novel> = {}): Novel {
  return {
    id,
    title: `Novel ${id}`,
    description: "",
    file_name: `${id}.txt`,
    relative_path: `${id}.txt`,
    source_id: null,
    storage_mode: "single",
    chapter_count: 0,
    access_mode: "inherit",
    soda_price: 0,
    preview_chapter_count: 0,
    content_hash: `hash-${id}`,
    size_bytes: 100,
    mtime_ms: 1,
    word_count: 100,
    visit_count: 0,
    last_accessed_at: null,
    last_accessed_ip: null,
    last_accessed_user_agent: null,
    created_at: "2026-07-16 00:00:00",
    updated_at: "2026-07-16 00:00:00",
    ...overrides,
  };
}

function insertIndexedNovel(db: DatabaseSync, item: Novel, content: string) {
  const normalized = normalizeSearchText(content);
  db.prepare("INSERT INTO content_trigram_fts(rowid, body) VALUES (?, ?)").run(item.id, normalized);
  db.prepare("INSERT INTO content_bigram_fts(rowid, tokens) VALUES (?, ?)").run(
    item.id,
    createBigramTokenDocument(normalized),
  );
  db.prepare(
    `INSERT INTO content_search_state
       (novel_id, content_hash, size_bytes, mtime_ms, index_version)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(item.id, item.content_hash, item.size_bytes, item.mtime_ms, CONTENT_SEARCH_INDEX_VERSION);
}

test("uses only current trigram and bigram FTS rows", () => {
  const db = new DatabaseSync(":memory:");
  initializeContentSearchDb(db);
  const first = novel(1);
  const second = novel(2);
  const uncovered = novel(3);
  insertIndexedNovel(db, first, "开头，张三丰，结尾");
  insertIndexedNovel(db, second, "海底火山");

  assert.deepEqual(findContentSearchCandidateNovelIds(db, [first, second], "张三丰"), {
    engine: "fts5-trigram",
    terms: ["张三丰"],
    candidateIds: [1],
    coveredNovelCount: 2,
    uncoveredNovelCount: 0,
  });
  assert.deepEqual(findContentSearchCandidateNovelIds(db, [first, second], "三丰"), {
    engine: "fts5-bigram",
    terms: ["三丰"],
    candidateIds: [1],
    coveredNovelCount: 2,
    uncoveredNovelCount: 0,
  });
  assert.deepEqual(findContentSearchCandidateNovelIds(db, [first, second], ["张三丰", "开头"]), {
    engine: "fts5-hybrid",
    terms: ["张三丰", "开头"],
    candidateIds: [1],
    coveredNovelCount: 2,
    uncoveredNovelCount: 0,
  });
  assert.deepEqual(findContentSearchCandidateNovelIds(db, [first, second, uncovered], "不存在")?.candidateIds, []);

  deleteContentSearchIndexNovel(db, first.id);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_search_state").get() as { count: number }).count, 1);
  clearContentSearchIndex(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM content_search_state").get() as { count: number }).count, 0);
  db.close();
});

test("stores and deletes each library index independently", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-content-search-shards-"));
  const previousDirectory = process.env.CONTENT_SEARCH_INDEX_DIR;
  process.env.CONTENT_SEARCH_INDEX_DIR = path.join(root, "indexes");
  try {
    const first = getContentSearchDb(1);
    const second = getContentSearchDb(2);
    insertIndexedNovel(first, novel(1, { source_id: 1 }), "第一书库银河核心");
    insertIndexedNovel(second, novel(2, { source_id: 2 }), "第二书库海底火山");
    assert.notEqual(getContentSearchDatabasePathForSource(1), getContentSearchDatabasePathForSource(2));
    assert.equal((first.prepare("SELECT COUNT(*) AS count FROM content_search_state").get() as { count: number }).count, 1);
    assert.equal((second.prepare("SELECT COUNT(*) AS count FROM content_search_state").get() as { count: number }).count, 1);

    deleteContentSearchDatabase(1);
    assert.equal(await fs.stat(getContentSearchDatabasePathForSource(2)).then(() => true), true);
    assert.equal((second.prepare("SELECT COUNT(*) AS count FROM content_search_state").get() as { count: number }).count, 1);
    await assert.rejects(fs.stat(getContentSearchDatabasePathForSource(1)));
  } finally {
    closeAllContentSearchDbs();
    if (previousDirectory === undefined) delete process.env.CONTENT_SEARCH_INDEX_DIR;
    else process.env.CONTENT_SEARCH_INDEX_DIR = previousDirectory;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("opens the legacy shared index read-only during rolling migration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-content-search-legacy-"));
  const previousLegacyPath = process.env.CONTENT_SEARCH_DB_PATH;
  process.env.CONTENT_SEARCH_DB_PATH = path.join(root, "content-search.db");
  const writer = new DatabaseSync(process.env.CONTENT_SEARCH_DB_PATH);
  initializeContentSearchDb(writer);
  insertIndexedNovel(writer, novel(1), "旧版索引仍有银河核心");
  writer.close();
  try {
    const legacy = getLegacyContentSearchDb();
    assert.ok(legacy);
    assert.deepEqual(findContentSearchCandidateNovelIds(legacy!, [novel(1)], "银河核心")?.candidateIds, [1]);
    assert.throws(() => legacy!.prepare("DELETE FROM content_search_state").run(), /readonly|read-only/i);
  } finally {
    closeAllContentSearchDbs();
    if (previousLegacyPath === undefined) delete process.env.CONTENT_SEARCH_DB_PATH;
    else process.env.CONTENT_SEARCH_DB_PATH = previousLegacyPath;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("publishes complete shard rebuilds atomically and keeps the previous shard on cancellation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-content-search-shadow-"));
  const libraryDir = path.join(root, "library");
  const previousDirectory = process.env.CONTENT_SEARCH_INDEX_DIR;
  const previousLibrary = process.env.NOVEL_LIBRARY_DIR;
  process.env.CONTENT_SEARCH_INDEX_DIR = path.join(root, "indexes");
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  await fs.mkdir(libraryDir, { recursive: true });
  const mainDb = new DatabaseSync(path.join(root, "main.db"));
  mainDb.exec(`
    CREATE TABLE novels (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      source_id INTEGER,
      storage_mode TEXT NOT NULL DEFAULT 'single',
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  try {
    await fs.writeFile(path.join(libraryDir, "1.txt"), "旧索引包含银河核心", "utf8");
    const stat = await fs.stat(path.join(libraryDir, "1.txt"));
    mainDb.prepare(
      "INSERT INTO novels (id, title, file_name, relative_path, source_id, content_hash, size_bytes, mtime_ms, word_count) VALUES (1, '第一本', '1.txt', '1.txt', 1, 'old', ?, ?, 9)",
    ).run(stat.size, stat.mtimeMs);
    await buildContentSearchSourceIndex(mainDb, 1, undefined, { force: true, optimize: false });
    const published = getContentSearchDb(1);
    const records = mainDb.prepare("SELECT * FROM novels").all() as Novel[];
    assert.deepEqual(findContentSearchCandidateNovelIds(published, records, "银河核心")?.candidateIds, [1]);

    await fs.writeFile(path.join(libraryDir, "1.txt"), "新正文只包含海底火山", "utf8");
    const updatedStat = await fs.stat(path.join(libraryDir, "1.txt"));
    mainDb.prepare("UPDATE novels SET content_hash = 'new', size_bytes = ?, mtime_ms = ? WHERE id = 1")
      .run(updatedStat.size, updatedStat.mtimeMs);
    await assert.rejects(
      buildContentSearchSourceIndex(mainDb, 1, undefined, { force: true, optimize: false, isCancelled: () => true }),
      /取消/,
    );
    const stillPublished = getContentSearchDb(1);
    const oldRecord = [{ ...records[0] }];
    assert.deepEqual(findContentSearchCandidateNovelIds(stillPublished, oldRecord, "银河核心")?.candidateIds, [1]);
    assert.equal((await fs.readdir(path.join(root, "indexes"))).some((name) => name.includes(".building-")), false);
  } finally {
    closeAllContentSearchDbs();
    mainDb.close();
    if (previousDirectory === undefined) delete process.env.CONTENT_SEARCH_INDEX_DIR;
    else process.env.CONTENT_SEARCH_INDEX_DIR = previousDirectory;
    if (previousLibrary === undefined) delete process.env.NOVEL_LIBRARY_DIR;
    else process.env.NOVEL_LIBRARY_DIR = previousLibrary;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("builds and incrementally refreshes an independent content search database", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-content-search-index-"));
  const libraryDir = path.join(root, "library");
  const searchPath = path.join(root, "content-search.db");
  const previousLibrary = process.env.NOVEL_LIBRARY_DIR;
  const previousSearchDb = process.env.CONTENT_SEARCH_DB_PATH;
  await fs.mkdir(libraryDir, { recursive: true });
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  process.env.CONTENT_SEARCH_DB_PATH = searchPath;

  const mainDb = new DatabaseSync(path.join(root, "main.db"));
  const searchDb = new DatabaseSync(searchPath);
  initializeContentSearchDb(searchDb);
  mainDb.exec(`
    CREATE TABLE novels (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      source_id INTEGER,
      storage_mode TEXT NOT NULL DEFAULT 'single',
      content_hash TEXT,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      word_count INTEGER NOT NULL,
      visit_count INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      last_accessed_ip TEXT,
      last_accessed_user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  async function writeNovel(id: number, content: string, hash: string) {
    const relativePath = `${id}.txt`;
    const filePath = path.join(libraryDir, relativePath);
    await fs.writeFile(filePath, content, "utf8");
    const stat = await fs.stat(filePath);
    mainDb.prepare(
      `INSERT INTO novels
         (id, title, file_name, relative_path, source_id, content_hash, size_bytes, mtime_ms, word_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         content_hash = excluded.content_hash,
         size_bytes = excluded.size_bytes,
         mtime_ms = excluded.mtime_ms,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(id, `Novel ${id}`, relativePath, relativePath, hash, stat.size, stat.mtimeMs, content.length);
  }

  try {
    await writeNovel(1, "开头，张三丰，结尾", "hash-a");
    await writeNovel(2, "海底火山", "hash-b");
    const firstBuild = await buildContentSearchIndex(mainDb, searchDb, undefined, { optimize: false });
    assert.equal(firstBuild.indexedBooks, 2);
    assert.equal(firstBuild.failedBooks, 0);

    const currentNovels = mainDb.prepare("SELECT * FROM novels ORDER BY id").all() as Novel[];
    assert.deepEqual(findContentSearchCandidateNovelIds(searchDb, currentNovels, "张三丰")?.candidateIds, [1]);

    const reusedBuild = await buildContentSearchIndex(mainDb, searchDb, undefined, { optimize: false });
    assert.equal(reusedBuild.reusedBooks, 2);
    assert.equal(reusedBuild.indexedBooks, 0);

    await writeNovel(1, "开头，东方不败，结尾", "hash-c");
    const incrementalBuild = await buildContentSearchIndex(mainDb, searchDb, undefined, { optimize: false });
    assert.equal(incrementalBuild.indexedBooks, 1);
    assert.equal(incrementalBuild.reusedBooks, 1);
    const updatedNovels = mainDb.prepare("SELECT * FROM novels ORDER BY id").all() as Novel[];
    assert.deepEqual(findContentSearchCandidateNovelIds(searchDb, updatedNovels, "张三丰")?.candidateIds, []);
    assert.deepEqual(findContentSearchCandidateNovelIds(searchDb, updatedNovels, "东方不败")?.candidateIds, [1]);

    mainDb.prepare(
      `INSERT INTO novels
         (id, title, file_name, relative_path, source_id, content_hash, size_bytes, mtime_ms, word_count, created_at, updated_at)
       VALUES (3, 'Missing', 'missing.txt', 'missing.txt', 1, 'hash-missing', 10, 1, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run();
    const failedBuild = await buildContentSearchIndex(mainDb, searchDb, undefined, { optimize: false });
    assert.equal(failedBuild.failedBooks, 1);
    assert.equal((searchDb.prepare("SELECT COUNT(*) AS count FROM content_search_failures").get() as { count: number }).count, 1);
    const summary = getContentSearchIndexSummary(mainDb, searchDb);
    assert.equal(summary.indexedBooks, 2);
    assert.equal(summary.pendingBooks, 1);
    assert.equal(summary.failedBooks, 1);
    const sourceSummary = getContentSearchIndexSummary(mainDb, searchDb, { sourceId: 1 });
    assert.equal(sourceSummary.totalBooks, 3);
    assert.equal(sourceSummary.indexedBooks, 2);

    mainDb.prepare("UPDATE novels SET content_hash = 'hash-stale' WHERE id = 2").run();
    const staleSummary = getContentSearchIndexSummary(mainDb, searchDb);
    assert.equal(staleSummary.indexedBooks, 1);
    assert.equal(staleSummary.pendingBooks, 2);
    assert.equal(staleSummary.staleBooks, 1);

    const scopedBuild = await buildContentSearchIndex(mainDb, searchDb, undefined, {
      optimize: false,
      novelIds: [1],
    });
    assert.equal(scopedBuild.totalBooks, 1);
    assert.equal((searchDb.prepare("SELECT COUNT(*) AS count FROM content_search_state WHERE novel_id = 2").get() as { count: number }).count, 0);
    const scopedSummary = getContentSearchIndexSummary(mainDb, searchDb, { novelIds: [1] });
    assert.equal(scopedSummary.totalBooks, 1);
    assert.equal(scopedSummary.pendingBooks, 0);
  } finally {
    mainDb.close();
    searchDb.close();
    if (previousLibrary === undefined) {
      delete process.env.NOVEL_LIBRARY_DIR;
    } else {
      process.env.NOVEL_LIBRARY_DIR = previousLibrary;
    }
    if (previousSearchDb === undefined) {
      delete process.env.CONTENT_SEARCH_DB_PATH;
    } else {
      process.env.CONTENT_SEARCH_DB_PATH = previousSearchDb;
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
