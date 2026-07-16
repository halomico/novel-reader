import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import test from "node:test";
import iconv from "iconv-lite";

test("uses the full-text index for mixed encodings and safely includes changed books", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-search-flow-"));
  const libraryDir = path.join(root, "library");
  let mainDb: DatabaseSync | undefined;
  let indexDb: DatabaseSync | undefined;
  let searchDb: DatabaseSync | undefined;
  await fs.mkdir(libraryDir, { recursive: true });
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.CONTENT_INDEX_DB_PATH = path.join(root, "content-index.db");
  process.env.CONTENT_SEARCH_DB_PATH = path.join(root, "content-search.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "admin-settings.json");
  process.env.FRONTEND_AUTO_CONTENT_INDEX = "true";

  const files = [
    { name: "utf8.txt", title: "UTF8 小说", content: Buffer.from("开头 张，三丰 结尾", "utf8") },
    { name: "gb18030.txt", title: "GB18030 小说", content: iconv.encode("开头 张三丰 结尾", "gb18030") },
    { name: "miss.txt", title: "未命中小说", content: Buffer.from("开头 张无忌 结尾", "utf8") },
  ];

  try {
    const { getDb } = await import("./db");
    const { getContentIndexDb } = await import("./content-index-db");
    const { getContentSearchDb } = await import("./content-search-db");
    const { buildContentSearchIndex } = await import("./content-search-index");
    const { buildNovelRecordFromFile, upsertNovelRecord } = await import("./novel-files");
    const { parseSearchQuery } = await import("./search-query");
    const { searchNovelContent } = await import("./search");
    const db = getDb();
    mainDb = db;
    indexDb = getContentIndexDb();
    searchDb = getContentSearchDb();
    const insert = db.prepare(
      `INSERT INTO novels
        (title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, updated_at)
       VALUES (?, ?, ?, NULL, ?, 1, ?, '2026-07-15 00:00:00')`,
    );

    for (const file of files) {
      await fs.writeFile(path.join(libraryDir, file.name), file.content);
      insert.run(file.title, file.name, file.name, file.content.length, file.content.length);
    }
    await buildContentSearchIndex(db, searchDb, undefined, { optimize: false });

    const matching = parseSearchQuery("张三丰");
    assert.equal(matching.ok, true);
    if (!matching.ok) {
      return;
    }
    const engines: string[] = [];
    const matchingResult = await searchNovelContent(matching.query, (progress) => {
      if (progress.scanEngine) {
        engines.push(progress.scanEngine);
      }
    });
    assert.deepEqual(
      matchingResult.results.map((result) => result.title).sort(),
      ["GB18030 小说", "UTF8 小说"],
    );
    assert.ok(engines.includes("fts5"));

    const twoCharacter = parseSearchQuery("三丰");
    assert.equal(twoCharacter.ok, true);
    if (twoCharacter.ok) {
      const result = await searchNovelContent(twoCharacter.query);
      assert.deepEqual(
        result.results.map((item) => item.title).sort(),
        ["GB18030 小说", "UTF8 小说"],
      );
    }

    await fs.writeFile(path.join(libraryDir, "gb18030.txt"), iconv.encode("新内容 张，三丰 仍然命中", "gb18030"));
    const changedRecord = buildNovelRecordFromFile("gb18030.txt");
    assert.equal("status" in changedRecord, false);
    if (!("status" in changedRecord)) {
      upsertNovelRecord(db, changedRecord);
    }
    const changedResult = await searchNovelContent(matching.query);
    assert.deepEqual(
      changedResult.results.map((result) => result.novelId).sort((left, right) => left - right),
      [1, 2],
    );

    const incremental = await buildContentSearchIndex(db, searchDb, undefined, { optimize: false });
    assert.equal(incremental.indexedBooks, 1);
    assert.equal(incremental.reusedBooks, 2);

    const missing = parseSearchQuery("海底火山");
    assert.equal(missing.ok, true);
    if (!missing.ok) {
      return;
    }
    const missingResult = await searchNovelContent(missing.query);
    assert.deepEqual(missingResult.results, []);
    assert.equal(missingResult.searchedBooks, 0);
  } finally {
    mainDb?.close();
    indexDb?.close();
    searchDb?.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    delete (globalThis as typeof globalThis & { novelReaderContentIndexDb?: DatabaseSync }).novelReaderContentIndexDb;
    delete (globalThis as typeof globalThis & { novelReaderContentSearchDb?: DatabaseSync }).novelReaderContentSearchDb;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
