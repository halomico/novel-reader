import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  appendUploadedNovelChapters,
  createNovelSource,
  deleteEmptyNovelSource,
  deleteNovelChapterIds,
  saveUploadedChapterNovel,
  saveUploadedNovels,
  updateNovelSourceSettings,
} from "./novel-files";
import {
  clearNovelChapterCache,
  getAdjacentNovelChapters,
  getNovelChapter,
  getNovelChapterPosition,
  getNovelSourceStoragePath,
  listNovelIdsBySource,
  listNovelSources,
  listNovelChaptersPage,
  readNovelChapterContent,
  resolveNovelLibraryScope,
  updateNovelChapterOverrides,
  updateNovelDescription,
} from "./novel-library";
import { getNovelById, listRecentlyUpdatedNovels } from "./books";
import { novelLibraryPreferenceCookieName } from "./novel-library-scope";

function withTempLibrary(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousLibraryDir = process.env.NOVEL_LIBRARY_DIR;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-chapters-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  process.env.NOVEL_LIBRARY_DIR = path.join(root, "library");
  fs.mkdirSync(process.env.NOVEL_LIBRARY_DIR, { recursive: true });
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  clearNovelChapterCache();
  t.after(() => {
    clearNovelChapterCache();
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousLibraryDir === undefined) delete process.env.NOVEL_LIBRARY_DIR;
    else process.env.NOVEL_LIBRARY_DIR = previousLibraryDir;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("reads chapter books in stable order and resolves adjacent chapters", async (t) => {
  withTempLibrary(t);
  const db = getDb();
  const sourceId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('archive', 'Archive', 'archive')",
  ).run().lastInsertRowid);
  const novelId = Number(db.prepare(
    `INSERT INTO novels (
       title, file_name, relative_path, source_id, storage_mode, chapter_count,
       content_hash, size_bytes, mtime_ms, word_count
     ) VALUES ('Chapter book', 'chapter-book', 'archive/chapter-book', ?, 'chapters', 3, 'book-v1', 30, 1, 30)`,
  ).run(sourceId).lastInsertRowid);
  const chapterDir = path.join(process.env.NOVEL_LIBRARY_DIR!, "archive", "chapter-book");
  fs.mkdirSync(chapterDir, { recursive: true });

  const chapterIds: number[] = [];
  for (let index = 0; index < 3; index += 1) {
    const relativePath = `archive/chapter-book/${index + 1}.txt`;
    fs.writeFileSync(path.join(process.env.NOVEL_LIBRARY_DIR!, relativePath), `chapter-${index + 1}`, "utf8");
    chapterIds.push(Number(db.prepare(
      `INSERT INTO novel_chapters (
         novel_id, title, relative_path, sort_order, content_hash, size_bytes, mtime_ms, word_count
       ) VALUES (?, ?, ?, ?, ?, 10, 1, 10)`,
    ).run(novelId, `Chapter ${index + 1}`, relativePath, index, `chapter-v${index + 1}`).lastInsertRowid));
  }

  const page = listNovelChaptersPage(novelId, 1, 100);
  assert.deepEqual(page.chapters.map((chapter) => chapter.id), chapterIds);
  assert.equal(page.totalChapters, 3);
  const middle = getNovelChapter(novelId, chapterIds[1])!;
  assert.deepEqual(getNovelChapterPosition(novelId, middle), { index: 1, total: 3 });
  const adjacent = getAdjacentNovelChapters(novelId, middle.sortOrder);
  assert.equal(adjacent.previous?.id, chapterIds[0]);
  assert.equal(adjacent.next?.id, chapterIds[2]);
  assert.equal(await readNovelChapterContent(middle), "chapter-2");
  assert.equal(await readNovelChapterContent(middle), "chapter-2");
});

test("uploads single-file novels directly into the selected source", async (t) => {
  withTempLibrary(t);
  const db = getDb();
  const sourceId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('imports', 'Imports', 'imports')",
  ).run().lastInsertRowid);
  const results = await saveUploadedNovels([
    new File(["uploaded content"], "Uploaded.txt", { type: "text/plain" }),
  ], sourceId);

  assert.equal(results[0]?.status, "saved");
  const row = db.prepare(
    "SELECT source_id, storage_mode, relative_path FROM novels WHERE id = ?",
  ).get(results[0]?.status === "saved" ? results[0].id : 0) as {
    source_id: number;
    storage_mode: string;
    relative_path: string;
  };
  assert.equal(row.source_id, sourceId);
  assert.equal(row.storage_mode, "single");
  assert.equal(row.relative_path, "imports/Uploaded.txt");
  assert.equal(fs.existsSync(path.join(process.env.NOVEL_LIBRARY_DIR!, row.relative_path)), true);
});

test("stores both default upload modes in the dedicated default directory", async (t) => {
  withTempLibrary(t);
  const db = getDb();
  const defaultSource = listNovelSources({ includeEmpty: true }).find((source) => source.slug === "default")!;

  const single = await saveUploadedNovels([
    new File(["single content"], "Default single.txt", { type: "text/plain" }),
  ], defaultSource.id);
  const chapters = await saveUploadedChapterNovel({
    title: "Default chapters",
    sourceId: defaultSource.id,
    files: [new File(["chapter content"], "1 Start.txt", { type: "text/plain" })],
  });

  const singleRow = db.prepare("SELECT relative_path FROM novels WHERE id = ?")
    .get(single[0]?.status === "saved" ? single[0].id : 0) as { relative_path: string };
  const chapterRow = db.prepare("SELECT relative_path FROM novels WHERE id = ?")
    .get(chapters.id) as { relative_path: string };
  assert.equal(getNovelSourceStoragePath(defaultSource), "default");
  assert.equal(singleRow.relative_path, "default/Default single.txt");
  assert.equal(chapterRow.relative_path, "default/Default chapters");
  assert.equal(fs.existsSync(path.join(process.env.NOVEL_LIBRARY_DIR!, singleRow.relative_path)), true);
  assert.equal(fs.existsSync(path.join(process.env.NOVEL_LIBRARY_DIR!, chapterRow.relative_path)), true);

  const refreshed = listNovelSources({ includeEmpty: true }).find((source) => source.id === defaultSource.id)!;
  assert.equal(refreshed.singleNovelCount, 1);
  assert.equal(refreshed.chapterNovelCount, 1);
});

test("defaults every library scope to default and crosses libraries only when explicitly requested", (t) => {
  withTempLibrary(t);
  const db = getDb();
  const defaultScope = resolveNovelLibraryScope();
  assert.equal(defaultScope.kind, "source");
  assert.equal(defaultScope.slug, "default");
  assert.equal(resolveNovelLibraryScope("missing").slug, "default");
  assert.equal(resolveNovelLibraryScope("all").kind, "all");

  const archiveId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('archive', 'Archive', 'archive')",
  ).run().lastInsertRowid);
  const archiveScope = resolveNovelLibraryScope("archive");
  assert.equal(archiveScope.kind, "source");
  assert.equal(archiveScope.source?.id, archiveId);
  const novelId = Number(db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, source_id, storage_mode, chapter_count, size_bytes, mtime_ms, word_count)
     VALUES ('Archive book', 'archive.txt', 'archive/archive.txt', ?, 'single', 0, 1, 1, 1)`,
  ).run(archiveId).lastInsertRowid);
  assert.deepEqual(listNovelIdsBySource(archiveId), [novelId]);
  assert.deepEqual(listNovelIdsBySource(defaultScope.source?.id || 0), []);
});

test("keeps remembered library cookies user-specific and recent updates cross-library", (t) => {
  withTempLibrary(t);
  const db = getDb();
  const defaultSource = resolveNovelLibraryScope().source!;
  const archiveId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('archive', 'Archive', 'archive')",
  ).run().lastInsertRowid);
  db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, source_id, storage_mode, chapter_count, size_bytes, mtime_ms, word_count)
     VALUES (?, ?, ?, ?, 'single', 0, 1, ?, 1)`,
  ).run("Default book", "default.txt", "default/default.txt", defaultSource.id, 10);
  db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, source_id, storage_mode, chapter_count, size_bytes, mtime_ms, word_count)
     VALUES (?, ?, ?, ?, 'single', 0, 1, ?, 1)`,
  ).run("Archive book", "archive.txt", "archive/archive.txt", archiveId, 20);

  assert.equal(novelLibraryPreferenceCookieName(7), "novel-library-selection-7");
  assert.equal(novelLibraryPreferenceCookieName(8), "novel-library-selection-8");
  const recent = listRecentlyUpdatedNovels({ pageSize: 10 });
  assert.equal(recent.totalBooks, 2);
  assert.deepEqual(recent.books.map((book) => book.title), ["Archive book", "Default book"]);
});

test("creates, renames, orders and removes an empty managed source", (t) => {
  withTempLibrary(t);
  const sourceId = createNovelSource({ folderName: "imports", name: "导入书库" });
  const folderPath = path.join(process.env.NOVEL_LIBRARY_DIR!, "imports");
  assert.equal(fs.existsSync(folderPath), true);

  updateNovelSourceSettings(sourceId, { name: "精选导入", sortOrder: 30 });
  const source = listNovelSources({ includeEmpty: true }).find((item) => item.id === sourceId)!;
  assert.equal(source.name, "精选导入");
  assert.equal(source.sortOrder, 30);
  assert.equal(source.novelCount, 0);

  deleteEmptyNovelSource(sourceId);
  assert.equal(listNovelSources({ includeEmpty: true }).some((item) => item.id === sourceId), false);
  assert.equal(fs.existsSync(folderPath), false);
  assert.throws(() => createNovelSource({ folderName: "default" }), /保留/);
});

test("creates and manages a chapter novel without relying on a library rescan", async (t) => {
  withTempLibrary(t);
  const db = getDb();
  const sourceId = Number(db.prepare(
    "INSERT INTO novel_sources (slug, name, relative_path) VALUES ('serials', 'Serials', 'serials')",
  ).run().lastInsertRowid);

  const created = await saveUploadedChapterNovel({
    title: "Managed chapters",
    sourceId,
    files: [
      new File(["final"], "10 Finale.txt", { type: "text/plain" }),
      new File(["middle"], "2 Middle.txt", { type: "text/plain" }),
      new File(["intro"], "1 Intro.txt", { type: "text/plain" }),
    ],
  });
  assert.equal(created.chapters, 3);
  let chapters = listNovelChaptersPage(created.id, 1, 100).chapters;
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["1 Intro", "2 Middle", "10 Finale"]);

  updateNovelChapterOverrides(created.id, [
    { id: chapters[0].id, title: "Opening", sortOrder: 1 },
    { id: chapters[1].id, title: chapters[1].title, sortOrder: 2 },
    { id: chapters[2].id, title: chapters[2].title, sortOrder: 0 },
  ]);
  chapters = listNovelChaptersPage(created.id, 1, 100).chapters;
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["10 Finale", "Opening", "2 Middle"]);

  assert.equal(await appendUploadedNovelChapters(created.id, [
    new File(["extra"], "11 Extra.txt", { type: "text/plain" }),
  ]), 1);
  chapters = listNovelChaptersPage(created.id, 1, 100).chapters;
  assert.equal(chapters.length, 4);
  const deleted = chapters[1];
  assert.equal(deleteNovelChapterIds(created.id, [deleted.id]), 1);
  assert.equal(fs.existsSync(path.join(process.env.NOVEL_LIBRARY_DIR!, deleted.relativePath)), false);
  assert.equal(listNovelChaptersPage(created.id, 1, 100).totalChapters, 3);
});

test("migrates and stores an optional normalized book description", (t) => {
  withTempLibrary(t);
  const legacy = new DatabaseSync(process.env.DATABASE_PATH!);
  legacy.exec(`
    CREATE TABLE novels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  legacy.close();
  const db = getDb();
  assert.equal(
    (db.prepare("PRAGMA table_info(novels)").all() as Array<{ name: string }>).some((column) => column.name === "description"),
    true,
  );
  const source = resolveNovelLibraryScope().source!;
  const novelId = Number(db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, source_id, storage_mode, chapter_count, size_bytes, mtime_ms, word_count)
     VALUES ('Described book', 'described.txt', 'default/described.txt', ?, 'single', 0, 1, 1, 1)`,
  ).run(source.id).lastInsertRowid);

  assert.equal(updateNovelDescription(novelId, "  First line\r\nSecond line  "), "First line\nSecond line");
  assert.equal(getNovelById(novelId)?.description, "First line\nSecond line");
  assert.throws(() => updateNovelDescription(novelId, "x".repeat(2_001)), /2000/);
});
