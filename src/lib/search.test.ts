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
  let searchDb: DatabaseSync | undefined;
  await fs.mkdir(libraryDir, { recursive: true });
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.CONTENT_SEARCH_DB_PATH = path.join(root, "content-search.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(root, "admin-settings.json");

  const files = [
    { name: "utf8.txt", title: "UTF8 小说", content: Buffer.from("开头 张，三丰 结尾", "utf8") },
    { name: "gb18030.txt", title: "GB18030 小说", content: iconv.encode("开头 张三丰 结尾", "gb18030") },
    { name: "miss.txt", title: "未命中小说", content: Buffer.from("开头 张无忌 结尾", "utf8") },
  ];

  try {
    const { getDb } = await import("./db");
    const { getContentSearchDb } = await import("./content-search-db");
    const { buildContentSearchIndex } = await import("./content-search-index");
    const { buildNovelRecordFromFile, upsertNovelRecord } = await import("./novel-files");
    const { parseSearchQuery } = await import("./search-query");
    const { searchNovelContent } = await import("./search");
    const db = getDb();
    mainDb = db;
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
    const scopedResult = await searchNovelContent(matching.query, undefined, { candidateNovelIds: [2] });
    assert.deepEqual(scopedResult.results.map((result) => result.title), ["GB18030 小说"]);
    const emptyScopeResult = await searchNovelContent(matching.query, undefined, { candidateNovelIds: [] });
    assert.deepEqual(emptyScopeResult.results, []);
    assert.equal(emptyScopeResult.searchedBooks, 0);

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

    searchDb.exec("DROP TABLE content_trigram_fts; DROP TABLE content_bigram_fts;");
    const previousRipgrepPath = process.env.RIPGREP_PATH;
    process.env.RIPGREP_PATH = path.join(root, "missing-ripgrep");
    try {
      const fallbackScopedResult = await searchNovelContent(matching.query, undefined, { candidateNovelIds: [2] });
      assert.deepEqual(fallbackScopedResult.results.map((result) => result.novelId), [2]);
    } finally {
      if (previousRipgrepPath === undefined) delete process.env.RIPGREP_PATH;
      else process.env.RIPGREP_PATH = previousRipgrepPath;
    }
  } finally {
    mainDb?.close();
    searchDb?.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    delete (globalThis as typeof globalThis & { novelReaderContentSearchDb?: DatabaseSync }).novelReaderContentSearchDb;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("updates a novel file, database metadata, and its title", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-editor-flow-"));
  const libraryDir = path.join(root, "library");
  const previousLibraryDir = process.env.NOVEL_LIBRARY_DIR;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousSearchPath = process.env.CONTENT_SEARCH_DB_PATH;
  let mainDb: DatabaseSync | undefined;
  let searchDb: DatabaseSync | undefined;

  await fs.mkdir(libraryDir, { recursive: true });
  process.env.NOVEL_LIBRARY_DIR = libraryDir;
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.CONTENT_SEARCH_DB_PATH = path.join(root, "content-search.db");

  try {
    const { getDb } = await import("./db");
    const { getContentSearchDb } = await import("./content-search-db");
    const { renameNovelFile, updateNovelFile } = await import("./novel-files");
    mainDb = getDb();
    searchDb = getContentSearchDb();
    await fs.writeFile(path.join(libraryDir, "旧书名.txt"), "旧正文", "utf8");
    const insert = mainDb
      .prepare(
        `INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms, word_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("旧书名", "旧书名.txt", "旧书名.txt", 9, 1, 3);

    updateNovelFile(Number(insert.lastInsertRowid), "新书名", "第一章\r\n新的正文");

    await assert.rejects(fs.access(path.join(libraryDir, "旧书名.txt")));
    assert.equal(await fs.readFile(path.join(libraryDir, "新书名.txt"), "utf8"), "第一章\n新的正文");
    assert.equal(renameNovelFile(Number(insert.lastInsertRowid), "最终书名"), true);
    await assert.rejects(fs.access(path.join(libraryDir, "新书名.txt")));
    assert.equal(await fs.readFile(path.join(libraryDir, "最终书名.txt"), "utf8"), "第一章\n新的正文");
    assert.equal(renameNovelFile(Number(insert.lastInsertRowid), "最终书名"), false);
    const updated = mainDb
      .prepare("SELECT title, file_name, relative_path, word_count, content_hash FROM novels WHERE id = ?")
      .get(Number(insert.lastInsertRowid)) as {
        title: string;
        file_name: string;
        relative_path: string;
        word_count: number;
        content_hash: string | null;
      };
    assert.equal(updated.title, "最终书名");
    assert.equal(updated.file_name, "最终书名.txt");
    assert.equal(updated.relative_path, "最终书名.txt");
    assert.equal(updated.word_count, 7);
    assert.match(updated.content_hash || "", /^[a-f0-9]{64}$/);
    assert.throws(
      () => updateNovelFile(Number(insert.lastInsertRowid), "最终书名", "   \n"),
      /正文不能为空/,
    );
    assert.equal(await fs.readFile(path.join(libraryDir, "最终书名.txt"), "utf8"), "第一章\n新的正文");
  } finally {
    mainDb?.close();
    searchDb?.close();
    delete (globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync }).novelReaderDb;
    delete (globalThis as typeof globalThis & { novelReaderContentSearchDb?: DatabaseSync }).novelReaderContentSearchDb;
    if (previousLibraryDir === undefined) delete process.env.NOVEL_LIBRARY_DIR;
    else process.env.NOVEL_LIBRARY_DIR = previousLibraryDir;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousSearchPath === undefined) delete process.env.CONTENT_SEARCH_DB_PATH;
    else process.env.CONTENT_SEARCH_DB_PATH = previousSearchPath;
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
