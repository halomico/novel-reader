import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getLibraryDir } from "../src/lib/config";
import { getContentSearchDb } from "../src/lib/content-search-db";
import { invalidateContentSearchResultCache } from "../src/lib/content-search-cache";
import { deleteContentSearchIndexNovel } from "../src/lib/content-search-index";
import { getDb } from "../src/lib/db";
import { isNovelTextFile, parseNovelTitle } from "../src/lib/filename";
import { invalidateNovelIdCache } from "../src/lib/novel-id-sampler";
import {
  buildNovelRecordFromRelativeFile,
  type NovelFileRecord,
} from "../src/lib/novel-files";
import { DEFAULT_NOVEL_SOURCE_DIRECTORY, upsertNovelSource } from "../src/lib/novel-library";

type ScannedChapter = NovelFileRecord & { sortOrder: number };

type ScannedBook = {
  title: string;
  fileName: string;
  relativePath: string;
  sourceId: number;
  storageMode: "single" | "chapters";
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  chapters: ScannedChapter[];
};

type ScanStats = {
  books: number;
  files: number;
  insertedOrUpdated: number;
  skipped: number;
  records: string[];
};

const libraryDir = getLibraryDir();
const db = getDb();
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

fs.mkdirSync(libraryDir, { recursive: true });

function directTextFiles(directory: string, relativeDirectory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isNovelTextFile(entry.name))
    .map((entry) => relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name)
    .sort((left, right) => collator.compare(left, right));
}

function sourceDirectories(): Array<{ name: string; relativePath: string; fullPath: string }> {
  return fs.readdirSync(libraryDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      relativePath: entry.name,
      fullPath: path.join(libraryDir, entry.name),
    }))
    .sort((left, right) => collator.compare(left.name, right.name));
}

function singleBook(record: NovelFileRecord, sourceId: number): ScannedBook {
  return {
    title: record.title,
    fileName: record.fileName,
    relativePath: record.relativePath,
    sourceId,
    storageMode: "single",
    contentHash: record.contentHash,
    sizeBytes: record.sizeBytes,
    mtimeMs: record.mtimeMs,
    wordCount: record.wordCount,
    chapters: [],
  };
}

function chapterBook(
  sourceId: number,
  sourceRelativePath: string,
  directoryName: string,
  chapterPaths: string[],
): ScannedBook | null {
  const chapters = chapterPaths.flatMap((relativePath, index) => {
    const record = buildNovelRecordFromRelativeFile(relativePath);
    return "status" in record ? [] : [{ ...record, sortOrder: index }];
  });
  if (!chapters.length) return null;
  const contentHash = crypto.createHash("sha256");
  for (const chapter of chapters) {
    contentHash.update(chapter.relativePath).update("\0").update(chapter.contentHash).update("\0");
  }
  return {
    title: parseNovelTitle(`${directoryName}.txt`) || directoryName,
    fileName: directoryName,
    relativePath: sourceRelativePath ? `${sourceRelativePath}/${directoryName}` : directoryName,
    sourceId,
    storageMode: "chapters",
    contentHash: contentHash.digest("hex"),
    sizeBytes: chapters.reduce((total, chapter) => total + chapter.sizeBytes, 0),
    mtimeMs: Math.max(...chapters.map((chapter) => chapter.mtimeMs)),
    wordCount: chapters.reduce((total, chapter) => total + chapter.wordCount, 0),
    chapters,
  };
}

function discoverBooks(stats: ScanStats): ScannedBook[] {
  const books: ScannedBook[] = [];
  const defaultSourceId = upsertNovelSource("", "默认来源");
  for (const relativePath of directTextFiles(libraryDir, "")) {
    stats.files += 1;
    const record = buildNovelRecordFromRelativeFile(relativePath);
    if ("status" in record) {
      stats.skipped += 1;
      stats.records.push(`${record.fileName}: ${record.reason}`);
    } else {
      books.push(singleBook(record, defaultSourceId));
    }
  }

  for (const source of sourceDirectories()) {
    const isDefaultDirectory = source.relativePath.toLocaleLowerCase("en-US") === DEFAULT_NOVEL_SOURCE_DIRECTORY;
    const sourceId = isDefaultDirectory
      ? defaultSourceId
      : upsertNovelSource(source.relativePath, source.name);
    for (const relativePath of directTextFiles(source.fullPath, source.relativePath)) {
      stats.files += 1;
      const record = buildNovelRecordFromRelativeFile(relativePath);
      if ("status" in record) {
        stats.skipped += 1;
        stats.records.push(`${record.fileName}: ${record.reason}`);
      } else {
        books.push(singleBook(record, sourceId));
      }
    }
    const bookDirectories = fs.readdirSync(source.fullPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((left, right) => collator.compare(left.name, right.name));
    for (const bookDirectory of bookDirectories) {
      const relativeDirectory = `${source.relativePath}/${bookDirectory.name}`;
      const chapterPaths = directTextFiles(path.join(source.fullPath, bookDirectory.name), relativeDirectory);
      stats.files += chapterPaths.length;
      const book = chapterBook(sourceId, source.relativePath, bookDirectory.name, chapterPaths);
      if (book) books.push(book);
    }
  }
  return books;
}

const existingByPath = db.prepare(
  `SELECT id, content_hash, size_bytes, mtime_ms, storage_mode
   FROM novels WHERE relative_path = ?`,
);
const duplicateInSource = db.prepare(
  `SELECT id, relative_path
   FROM novels
   WHERE source_id = ? AND title = ? AND content_hash = ? AND relative_path != ?
   ORDER BY id ASC LIMIT 1`,
);
const upsertBook = db.prepare(
  `INSERT INTO novels (
     title, file_name, relative_path, source_id, storage_mode, chapter_count,
     content_hash, size_bytes, mtime_ms, word_count, updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(relative_path) DO UPDATE SET
     title = excluded.title,
     file_name = excluded.file_name,
     source_id = excluded.source_id,
     storage_mode = excluded.storage_mode,
     chapter_count = excluded.chapter_count,
     content_hash = excluded.content_hash,
     size_bytes = excluded.size_bytes,
     mtime_ms = excluded.mtime_ms,
     word_count = excluded.word_count,
     updated_at = CURRENT_TIMESTAMP
   RETURNING id`,
);
const upsertChapter = db.prepare(
  `INSERT INTO novel_chapters (
     novel_id, title, relative_path, sort_order, content_hash,
     size_bytes, mtime_ms, word_count, updated_at
   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
   ON CONFLICT(relative_path) DO UPDATE SET
     novel_id = excluded.novel_id,
     title = excluded.title,
     sort_order = excluded.sort_order,
     content_hash = excluded.content_hash,
     size_bytes = excluded.size_bytes,
     mtime_ms = excluded.mtime_ms,
     word_count = excluded.word_count,
     updated_at = CURRENT_TIMESTAMP`,
);

function syncChapters(novelId: number, chapters: ScannedChapter[]) {
  if (!chapters.length) {
    db.prepare("DELETE FROM novel_chapters WHERE novel_id = ?").run(novelId);
    return;
  }
  db.prepare("UPDATE novel_chapters SET sort_order = sort_order + 1000000 WHERE novel_id = ?").run(novelId);
  for (const chapter of chapters) {
    upsertChapter.run(
      novelId,
      chapter.title,
      chapter.relativePath,
      chapter.sortOrder,
      chapter.contentHash,
      chapter.sizeBytes,
      chapter.mtimeMs,
      chapter.wordCount,
    );
  }
  const placeholders = chapters.map(() => "?").join(", ");
  db.prepare(
    `DELETE FROM novel_chapters
     WHERE novel_id = ? AND relative_path NOT IN (${placeholders})`,
  ).run(novelId, ...chapters.map((chapter) => chapter.relativePath));
}

function scan() {
  const startedAt = Date.now();
  const stats: ScanStats = { books: 0, files: 0, insertedOrUpdated: 0, skipped: 0, records: [] };
  const books = discoverBooks(stats);
  stats.books = books.length;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const book of books) {
      const duplicate = duplicateInSource.get(
        book.sourceId,
        book.title,
        book.contentHash,
        book.relativePath,
      ) as { id: number; relative_path: string } | undefined;
      if (duplicate && book.storageMode === "single") {
        stats.skipped += 1;
        stats.records.push(`${book.relativePath}: 与 ${duplicate.relative_path} 内容相同，已跳过索引`);
        continue;
      }
      const existing = existingByPath.get(book.relativePath) as {
        id: number;
        content_hash: string | null;
        size_bytes: number;
        mtime_ms: number;
        storage_mode: string;
      } | undefined;
      const changed = !existing ||
        existing.content_hash !== book.contentHash ||
        existing.size_bytes !== book.sizeBytes ||
        existing.mtime_ms !== book.mtimeMs ||
        existing.storage_mode !== book.storageMode;
      if (existing && changed) deleteContentSearchIndexNovel(getContentSearchDb(), existing.id);
      const row = upsertBook.get(
        book.title,
        book.fileName,
        book.relativePath,
        book.sourceId,
        book.storageMode,
        book.chapters.length,
        book.contentHash,
        book.sizeBytes,
        book.mtimeMs,
        book.wordCount,
      ) as { id: number };
      syncChapters(row.id, book.chapters);
      if (changed) stats.insertedOrUpdated += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  if (stats.insertedOrUpdated) {
    invalidateContentSearchResultCache();
    invalidateNovelIdCache();
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`扫描完成：${stats.books} 本，${stats.files} 个文件，更新 ${stats.insertedOrUpdated} 本，跳过 ${stats.skipped} 项，耗时 ${elapsed}s`);
  for (const record of stats.records) console.log(`- ${record}`);
}

scan();
