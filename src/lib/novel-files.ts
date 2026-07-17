import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getLibraryDir } from "./config";
import { getContentSearchDb } from "./content-search-db";
import { deleteContentSearchIndexNovel } from "./content-search-index";
import { getDb } from "./db";
import { isNovelTextFile, parseNovelTitle } from "./filename";
import { decodeNovelBuffer } from "./text";

export type NovelFileRecord = {
  title: string;
  fileName: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
};

export type SavedNovelResult =
  | { status: "saved"; title: string; fileName: string; id: number }
  | { status: "duplicate"; title: string; fileName: string; keptFileName: string }
  | { status: "skipped"; fileName: string; reason: string };

type SkippedNovelResult = { status: "skipped"; fileName: string; reason: string };

type ExistingNovel = {
  id: number;
  title: string;
  file_name: string;
  relative_path: string;
  content_hash: string | null;
};

type DeletedNovel = ExistingNovel & {
  fileDeleteFailed: boolean;
};

export type DeleteNovelSummary = {
  deleted: number;
  fileDeleteFailures: string[];
};

function getLibraryRoot(): string {
  return path.resolve(getLibraryDir());
}

function isInsideLibrary(filePath: string): boolean {
  const libraryRoot = getLibraryRoot();
  const resolved = path.resolve(filePath);
  return resolved === libraryRoot || resolved.startsWith(`${libraryRoot}${path.sep}`);
}

export function resolveLibraryFile(relativePath: string): string {
  const fullPath = path.resolve(getLibraryRoot(), relativePath);
  if (!isInsideLibrary(fullPath) || fullPath === getLibraryRoot()) {
    throw new Error("小说文件路径不在书库目录内");
  }
  return fullPath;
}

export function hashNovelBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function countNovelWords(buffer: Buffer): number {
  return Array.from(decodeNovelBuffer(buffer).replace(/\s+/g, "")).length;
}

export function sanitizeNovelFileName(fileName: string): string | null {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  if (!baseName || !isNovelTextFile(baseName)) {
    return null;
  }
  return baseName;
}

function createUniqueFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = fileName;
  let index = 2;

  while (fs.existsSync(resolveLibraryFile(candidate))) {
    candidate = `${parsed.name}-${index}${parsed.ext}`;
    index += 1;
  }

  return candidate;
}

export function buildNovelRecordFromFile(fileName: string): SkippedNovelResult | NovelFileRecord {
  const safeFileName = sanitizeNovelFileName(fileName);
  if (!safeFileName) {
    return { status: "skipped", fileName, reason: "只支持 .txt 小说文件" };
  }

  const title = parseNovelTitle(safeFileName);
  if (!title) {
    return { status: "skipped", fileName: safeFileName, reason: "文件名解析后的标题为空" };
  }

  const fullPath = resolveLibraryFile(safeFileName);
  const buffer = fs.readFileSync(fullPath);
  const fileStat = fs.statSync(fullPath);

  return {
    title,
    fileName: safeFileName,
    relativePath: safeFileName,
    contentHash: hashNovelBuffer(buffer),
    sizeBytes: fileStat.size,
    mtimeMs: Math.round(fileStat.mtimeMs),
    wordCount: countNovelWords(buffer),
  };
}

export function findDuplicateNovel(db: DatabaseSync, title: string, contentHash: string, relativePath?: string): ExistingNovel | null {
  const sql = relativePath
    ? `SELECT id, title, file_name, relative_path, content_hash
       FROM novels
       WHERE title = ? AND content_hash = ? AND relative_path != ?
       ORDER BY id ASC
       LIMIT 1`
    : `SELECT id, title, file_name, relative_path, content_hash
       FROM novels
       WHERE title = ? AND content_hash = ?
       ORDER BY id ASC
       LIMIT 1`;
  const params = relativePath ? [title, contentHash, relativePath] : [title, contentHash];
  const duplicate = db.prepare(sql).get(...params) as ExistingNovel | undefined;

  return duplicate || null;
}

export function upsertNovelRecord(db: DatabaseSync, record: NovelFileRecord): number {
  const existing = db
    .prepare("SELECT id, content_hash, size_bytes, mtime_ms FROM novels WHERE relative_path = ?")
    .get(record.relativePath) as { id: number; content_hash: string | null; size_bytes: number; mtime_ms: number } | undefined;
  if (
    existing &&
    (existing.content_hash !== record.contentHash || existing.size_bytes !== record.sizeBytes || existing.mtime_ms !== record.mtimeMs)
  ) {
    deleteContentSearchIndexNovel(getContentSearchDb(), existing.id);
  }

  db.prepare(
    `INSERT INTO novels (title, file_name, relative_path, content_hash, size_bytes, mtime_ms, word_count, updated_at)
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
         OR novels.word_count IS NOT excluded.word_count`,
  ).run(record);

  const row = db.prepare("SELECT id FROM novels WHERE relative_path = ?").get(record.relativePath) as { id: number } | undefined;
  if (!row) {
    throw new Error("小说入库后无法读取记录");
  }
  return row.id;
}

export function deleteNovelByRelativePath(db: DatabaseSync, relativePath: string): boolean {
  const row = db.prepare("SELECT id FROM novels WHERE relative_path = ?").get(relativePath) as { id: number } | undefined;
  if (!row) {
    return false;
  }

  deleteContentSearchIndexNovel(getContentSearchDb(), row.id);
  db.prepare("DELETE FROM novels WHERE id = ?").run(row.id);
  return true;
}

export function deleteNovelById(db: DatabaseSync, id: number): DeletedNovel | null {
  const novel = db
    .prepare("SELECT id, title, file_name, relative_path, content_hash FROM novels WHERE id = ?")
    .get(id) as ExistingNovel | undefined;

  if (!novel) {
    return null;
  }

  const filePath = resolveLibraryFile(novel.relative_path);
  db.exec("BEGIN");
  try {
    deleteContentSearchIndexNovel(getContentSearchDb(), id);
    db.prepare("DELETE FROM novels WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  let fileDeleteFailed = false;
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      fileDeleteFailed = true;
    }
  }

  return { ...novel, fileDeleteFailed };
}

export function deleteNovelIds(ids: number[]): DeleteNovelSummary {
  const db = getDb();
  let deleted = 0;
  const fileDeleteFailures: string[] = [];

  for (const id of new Set(ids)) {
    const novel = Number.isInteger(id) && id > 0 ? deleteNovelById(db, id) : null;
    if (novel) {
      deleted += 1;
      if (novel.fileDeleteFailed) {
        fileDeleteFailures.push(novel.file_name);
      }
    }
  }

  return { deleted, fileDeleteFailures };
}

export async function saveUploadedNovels(files: File[]): Promise<SavedNovelResult[]> {
  const db = getDb();
  const libraryRoot = getLibraryRoot();
  fs.mkdirSync(libraryRoot, { recursive: true });
  const results: SavedNovelResult[] = [];

  for (const file of files) {
    const fileName = sanitizeNovelFileName(file.name);
    if (!fileName) {
      results.push({ status: "skipped", fileName: file.name || "unknown", reason: "只支持 .txt 小说文件" });
      continue;
    }

    const title = parseNovelTitle(fileName);
    if (!title) {
      results.push({ status: "skipped", fileName, reason: "文件名解析后的标题为空" });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentHash = hashNovelBuffer(buffer);
    const duplicate = findDuplicateNovel(db, title, contentHash);
    if (duplicate) {
      if (fs.existsSync(resolveLibraryFile(duplicate.relative_path))) {
        results.push({ status: "duplicate", title, fileName, keptFileName: duplicate.file_name });
        continue;
      }
      deleteNovelByRelativePath(db, duplicate.relative_path);
    }

    const uniqueFileName = createUniqueFileName(fileName);
    const filePath = resolveLibraryFile(uniqueFileName);
    fs.writeFileSync(filePath, buffer, { flag: "wx" });
    let id: number;
    try {
      const fileStat = fs.statSync(filePath);
      id = upsertNovelRecord(db, {
        title,
        fileName: uniqueFileName,
        relativePath: uniqueFileName,
        contentHash,
        sizeBytes: fileStat.size,
        mtimeMs: Math.round(fileStat.mtimeMs),
        wordCount: countNovelWords(buffer),
      });
    } catch (error) {
      try {
        fs.rmSync(filePath, { force: true });
      } catch {
        // Preserve the database error; a leftover file can be reconciled by the scanner.
      }
      throw error;
    }
    results.push({ status: "saved", title, fileName: uniqueFileName, id });
  }

  return results;
}
