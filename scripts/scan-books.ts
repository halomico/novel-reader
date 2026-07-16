import "dotenv/config";

import fs from "node:fs";
import { getLibraryDir } from "../src/lib/config";
import { deleteIndexedContentForNovel } from "../src/lib/content-index";
import { getDb } from "../src/lib/db";
import { isNovelTextFile } from "../src/lib/filename";
import { buildNovelRecordFromFile, deleteNovelByRelativePath, resolveLibraryFile, type NovelFileRecord } from "../src/lib/novel-files";

type ScanStats = {
  scanned: number;
  insertedOrUpdated: number;
  deletedDuplicates: number;
  skipped: number;
  records: string[];
};

type PendingDuplicateFile = {
  fileName: string;
  keptFileName: string;
  filePath: string;
  sizeBytes: number;
  mtimeMs: number;
};

const libraryDir = getLibraryDir();
const db = getDb();

if (!fs.existsSync(libraryDir)) {
  fs.mkdirSync(libraryDir, { recursive: true });
}

const files = fs
  .readdirSync(libraryDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && isNovelTextFile(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

const stats: ScanStats = {
  scanned: files.length,
  insertedOrUpdated: 0,
  deletedDuplicates: 0,
  skipped: 0,
  records: [],
};

const findDuplicateByTitleHash = db.prepare(`
  SELECT id, title, file_name, relative_path, content_hash
  FROM novels
  WHERE title = ? AND content_hash = ? AND relative_path != ?
  ORDER BY id ASC
  LIMIT 1
`);

const upsertByPath = db.prepare(`
  INSERT INTO novels (title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, updated_at)
  VALUES (@title, @fileName, @relativePath, @contentHash, @sizeBytes, @mtimeMs, @wordCount, CURRENT_TIMESTAMP)
  ON CONFLICT(relative_path) DO UPDATE SET
    title = excluded.title,
    file_name = excluded.file_name,
    content_hash = excluded.content_hash,
    size_bytes = excluded.size_bytes,
    mtime_ms = excluded.mtime_ms,
    word_count = excluded.word_count,
    updated_at = CURRENT_TIMESTAMP
  WHERE novels.title IS NOT excluded.title
     OR novels.file_name IS NOT excluded.file_name
     OR novels.content_hash IS NOT excluded.content_hash
     OR novels.size_bytes IS NOT excluded.size_bytes
     OR novels.mtime_ms IS NOT excluded.mtime_ms
     OR novels.word_count IS NOT excluded.word_count
`);

const findExistingByPath = db.prepare(`
  SELECT id, content_hash, size_bytes, mtime_ms
  FROM novels
  WHERE relative_path = ?
  LIMIT 1
`);

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function elapsedSeconds(startedAt: number): string {
  return `${Math.round((Date.now() - startedAt) / 1000)}s`;
}

function readPositiveInt(name: string, fallback: number, min: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

function clearExistingIndexIfChanged(record: NovelFileRecord) {
  const existing = findExistingByPath.get(record.relativePath) as
    | { id: number; content_hash: string | null; size_bytes: number; mtime_ms: number }
    | undefined;
  if (
    existing &&
    (existing.content_hash !== record.contentHash || existing.size_bytes !== record.sizeBytes || existing.mtime_ms !== record.mtimeMs)
  ) {
    deleteIndexedContentForNovel(db, existing.id, true);
  }
}

function scan() {
  const startedAt = Date.now();
  const progressEvery = readPositiveInt("SCAN_PROGRESS_EVERY", 500, 100);
  const batchSize = readPositiveInt("SCAN_BATCH_SIZE", 500, 100);
  let totalBytes = 0;
  let transactionOpen = false;
  const pendingDuplicateFiles: PendingDuplicateFile[] = [];

  function deleteCommittedDuplicateFiles() {
    for (const pending of pendingDuplicateFiles) {
      try {
        if (!fs.existsSync(pending.filePath)) {
          stats.deletedDuplicates += 1;
          stats.records.push(`${pending.fileName}: 与 ${pending.keptFileName} 内容相同，重复文件已不存在`);
          continue;
        }
        const currentStat = fs.statSync(pending.filePath);
        if (currentStat.size !== pending.sizeBytes || Math.round(currentStat.mtimeMs) !== pending.mtimeMs) {
          stats.skipped += 1;
          stats.records.push(`${pending.fileName}: 扫描期间文件发生变化，已保留文件并跳过删除`);
          continue;
        }
        fs.unlinkSync(pending.filePath);
        stats.deletedDuplicates += 1;
        stats.records.push(`${pending.fileName}: 与 ${pending.keptFileName} 内容完全相同，已删除重复文件`);
      } catch (error) {
        stats.skipped += 1;
        stats.records.push(
          `${pending.fileName}: 重复数据库记录已清理，但文件删除失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
      }
    }
  }

  function finishStep(index: number) {
    if ((index + 1) % batchSize === 0) {
      db.exec("COMMIT");
      transactionOpen = false;
      db.exec("BEGIN");
      transactionOpen = true;
    }

    if ((index + 1) % progressEvery === 0) {
      console.log(
        `扫描进度: ${index + 1}/${stats.scanned}，已读 ${formatBytes(totalBytes)}，写入 ${stats.insertedOrUpdated}，删除重复 ${stats.deletedDuplicates}，跳过 ${stats.skipped}，耗时 ${elapsedSeconds(startedAt)}`,
      );
    }
  }

  console.log(`书库目录: ${libraryDir}`);
  console.log(`发现 txt: ${stats.scanned}`);
  console.log(`开始扫描；每 ${progressEvery} 本输出一次进度。`);

  db.exec("BEGIN");
  transactionOpen = true;
  try {
    for (const [index, fileName] of files.entries()) {
      const record = buildNovelRecordFromFile(fileName);

      if ("status" in record) {
        stats.skipped += 1;
        stats.records.push(`${record.fileName}: ${record.reason}`);
        finishStep(index);
        continue;
      }

      totalBytes += record.sizeBytes;
      const duplicate = findDuplicateByTitleHash.get(record.title, record.contentHash, record.relativePath) as
        | { id: number; title: string; file_name: string; relative_path: string; content_hash: string | null }
        | undefined;
      if (duplicate) {
        if (!fs.existsSync(resolveLibraryFile(duplicate.relative_path))) {
          deleteNovelByRelativePath(db, duplicate.relative_path);
          clearExistingIndexIfChanged(record);
          const result = upsertByPath.run(record);
          stats.insertedOrUpdated += Number(result.changes);
          stats.records.push(`${duplicate.file_name}: 数据库记录指向的文件不存在，已清理旧记录`);
          finishStep(index);
          continue;
        }

        deleteNovelByRelativePath(db, record.relativePath);
        pendingDuplicateFiles.push({
          fileName: record.fileName,
          keptFileName: duplicate.file_name,
          filePath: resolveLibraryFile(record.relativePath),
          sizeBytes: record.sizeBytes,
          mtimeMs: record.mtimeMs,
        });
        finishStep(index);
        continue;
      }

      clearExistingIndexIfChanged(record);
      const result = upsertByPath.run(record);
      stats.insertedOrUpdated += Number(result.changes);
      finishStep(index);
    }
    db.exec("COMMIT");
    transactionOpen = false;
    deleteCommittedDuplicateFiles();
    console.log(`扫描完成，耗时 ${elapsedSeconds(startedAt)}，读取约 ${formatBytes(totalBytes)}`);
  } catch (error) {
    if (transactionOpen) {
      db.exec("ROLLBACK");
    }
    throw error;
  }
}

scan();

console.log(`写入/更新: ${stats.insertedOrUpdated}`);
console.log(`删除同名同内容重复文件: ${stats.deletedDuplicates}`);
console.log(`跳过: ${stats.skipped}`);

if (stats.records.length > 0) {
  console.log("");
  console.log("处理记录:");
  for (const record of stats.records) {
    console.log(`- ${record}`);
  }
}
