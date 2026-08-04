import crypto from "node:crypto";
import fs from "node:fs";
import { isUtf8 } from "node:buffer";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import iconv from "iconv-lite";
import { getLibraryDir } from "./config";
import { invalidateContentSearchResultCache } from "./content-search-cache";
import { invalidateNovelContentSearchIndex } from "./content-search-maintenance";
import { getDb } from "./db";
import { isNovelTextFile, parseNovelTitle } from "./filename";
import { invalidateNovelIdCache } from "./novel-id-sampler";
import { getNovelSourceStoragePath, upsertNovelSource } from "./novel-library";
import { decodeNovelBuffer } from "./text";

export type NovelFileRecord = {
  title: string;
  fileName: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  sourceId?: number | null;
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
  storage_mode: "single" | "chapters";
};

type DeletedNovel = ExistingNovel & {
  fileDeleteFailed: boolean;
};

export type DeleteNovelSummary = {
  deleted: number;
  fileDeleteFailures: string[];
};

export type SavedChapterNovelResult = {
  id: number;
  title: string;
  chapters: number;
};

const INVALID_NOVEL_TITLE_PATTERN = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED_WINDOWS_NAME_PATTERN = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const chapterNameCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function normalizeNovelSourceName(name: string): string {
  const normalized = name.normalize("NFKC").trim();
  if (!normalized || normalized.length > 120) {
    throw new Error("来源名称应为 1 到 120 个字符");
  }
  return normalized;
}

function normalizeNovelSourceFolder(folderName: string): string {
  const normalized = folderName.normalize("NFKC").trim();
  if (!normalized || normalized.length > 120) {
    throw new Error("来源文件夹应为 1 到 120 个字符");
  }
  if (
    normalized.toLocaleLowerCase("en-US") === "default" ||
    INVALID_NOVEL_TITLE_PATTERN.test(normalized) ||
    RESERVED_WINDOWS_NAME_PATTERN.test(normalized) ||
    /[. ]$/.test(normalized) ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new Error("来源文件夹名称无效或已被系统保留");
  }
  return normalized;
}

export function createNovelSource(input: { folderName: string; name?: string }): number {
  const folderName = normalizeNovelSourceFolder(input.folderName);
  const name = normalizeNovelSourceName(input.name?.trim() || folderName);
  const db = getDb();
  const conflict = db.prepare(
    "SELECT id FROM novel_sources WHERE relative_path = ? COLLATE NOCASE",
  ).get(folderName) as { id: number } | undefined;
  if (conflict) throw new Error("该来源文件夹已在管理列表中");

  const folderPath = resolveLibraryFile(folderName);
  if (fs.existsSync(folderPath) && !fs.statSync(folderPath).isDirectory()) {
    throw new Error("同名路径不是文件夹");
  }
  const createdDirectory = !fs.existsSync(folderPath);
  if (createdDirectory) fs.mkdirSync(folderPath, { recursive: false });
  try {
    const nextOrder = Number((db.prepare(
      "SELECT COALESCE(MAX(sort_order), -10) + 10 AS value FROM novel_sources",
    ).get() as { value: number }).value);
    const sourceId = upsertNovelSource(folderName, name);
    db.prepare(
      "UPDATE novel_sources SET name = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(name, nextOrder, sourceId);
    return sourceId;
  } catch (error) {
    if (createdDirectory) {
      try {
        fs.rmdirSync(folderPath);
      } catch {
        // Keep the database error; the empty directory can be reused on retry.
      }
    }
    throw error;
  }
}

export function updateNovelSourceSettings(sourceIdValue: number, input: { name: string; sortOrder: number }): void {
  const sourceId = Math.floor(Number(sourceIdValue));
  if (!Number.isInteger(sourceId) || sourceId < 1) throw new Error("小说来源不存在");
  const name = normalizeNovelSourceName(input.name);
  const sortOrder = Math.min(Math.max(Math.floor(Number(input.sortOrder) || 0), -10_000), 10_000);
  const result = getDb().prepare(
    "UPDATE novel_sources SET name = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(name, sortOrder, sourceId);
  if (!result.changes) throw new Error("小说来源不存在");
}

export function deleteEmptyNovelSource(sourceIdValue: number): void {
  const sourceId = Math.floor(Number(sourceIdValue));
  const db = getDb();
  const source = db.prepare(
    `SELECT s.id, s.slug, s.relative_path, COUNT(n.id) AS novel_count
     FROM novel_sources s
     LEFT JOIN novels n ON n.source_id = s.id
     WHERE s.id = ?
     GROUP BY s.id`,
  ).get(sourceId) as { id: number; slug: string; relative_path: string; novel_count: number } | undefined;
  if (!source) throw new Error("小说来源不存在");
  if (source.slug.toLocaleLowerCase("en-US") === "default") throw new Error("默认来源不能删除");
  if (source.novel_count > 0) throw new Error("该来源仍有小说，不能删除");

  const relativePath = getNovelSourceStoragePath({ slug: source.slug, relativePath: source.relative_path });
  const folderPath = resolveLibraryFile(relativePath);
  const removedDirectory = fs.existsSync(folderPath);
  if (removedDirectory) {
    if (!fs.statSync(folderPath).isDirectory() || fs.readdirSync(folderPath).length > 0) {
      throw new Error("来源文件夹不为空，请先扫描或处理其中内容");
    }
    fs.rmdirSync(folderPath);
  }
  try {
    const result = db.prepare("DELETE FROM novel_sources WHERE id = ?").run(source.id);
    if (!result.changes) throw new Error("小说来源不存在");
  } catch (error) {
    if (removedDirectory) fs.mkdirSync(folderPath, { recursive: true });
    throw error;
  }
}

function normalizeNovelTitle(title: string): string {
  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > 120) {
    throw new Error("小说名称应为 1 到 120 个字符");
  }
  if (
    INVALID_NOVEL_TITLE_PATTERN.test(normalizedTitle) ||
    RESERVED_WINDOWS_NAME_PATTERN.test(normalizedTitle) ||
    /[. ]$/.test(normalizedTitle)
  ) {
    throw new Error("小说名称包含文件名不支持的字符");
  }
  return normalizedTitle;
}

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
    throw new Error("小说文件路径不在小说目录内");
  }
  return fullPath;
}

export function hashNovelBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function countNovelWords(buffer: Buffer): number {
  return Array.from(decodeNovelBuffer(buffer).replace(/\s+/g, "")).length;
}

export function updateNovelFile(id: number, title: string, content: string) {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error("小说不存在");
  }
  const normalizedTitle = normalizeNovelTitle(title);

  const db = getDb();
  const novel = db
    .prepare("SELECT id, title, file_name, relative_path, content_hash, storage_mode FROM novels WHERE id = ?")
    .get(id) as ExistingNovel | undefined;
  if (!novel) {
    throw new Error("小说不存在");
  }
  if (novel.storage_mode === "chapters") {
    throw new Error("章节小说请在章节编辑器中修改正文");
  }

  const currentPath = resolveLibraryFile(novel.relative_path);
  const extension = path.extname(novel.file_name) || ".txt";
  const nextFileName = `${normalizedTitle}${extension}`;
  const parentPath = path.posix.dirname(novel.relative_path.replace(/\\/g, "/"));
  const nextRelativePath = parentPath === "." ? nextFileName : path.posix.join(parentPath, nextFileName);
  const nextPath = resolveLibraryFile(nextRelativePath);
  const samePath = currentPath.toLocaleLowerCase("en-US") === nextPath.toLocaleLowerCase("en-US");
  if (!samePath && fs.existsSync(nextPath)) {
    throw new Error("小说目录中已存在同名文件");
  }

  const originalBuffer = fs.readFileSync(currentPath);
  const normalizedContent = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!normalizedContent.trim()) {
    throw new Error("小说正文不能为空");
  }
  const nextBuffer = isUtf8(originalBuffer)
    ? Buffer.from(normalizedContent, "utf8")
    : iconv.encode(normalizedContent, "gb18030");
  let moved = false;

  try {
    if (currentPath !== nextPath) {
      if (samePath) {
        const temporaryPath = `${currentPath}.${process.pid}.${Date.now()}.rename`;
        fs.renameSync(currentPath, temporaryPath);
        try {
          fs.renameSync(temporaryPath, nextPath);
        } catch (error) {
          fs.renameSync(temporaryPath, currentPath);
          throw error;
        }
      } else {
        fs.renameSync(currentPath, nextPath);
      }
      moved = true;
    }

    fs.writeFileSync(nextPath, nextBuffer);
    const fileStat = fs.statSync(nextPath);
    invalidateNovelContentSearchIndex(id, db);
    db.prepare(
      `UPDATE novels
       SET title = ?, file_name = ?, relative_path = ?, content_hash = ?, size_bytes = ?, mtime_ms = ?, word_count = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      normalizedTitle,
      nextFileName,
      nextRelativePath,
      hashNovelBuffer(nextBuffer),
      fileStat.size,
      Math.round(fileStat.mtimeMs),
      countNovelWords(nextBuffer),
      id,
    );
    invalidateContentSearchResultCache();
  } catch (error) {
    try {
      fs.writeFileSync(moved ? nextPath : currentPath, originalBuffer);
      if (moved) {
        fs.renameSync(nextPath, currentPath);
      }
    } catch {
      // Keep the original error; the scanner can reconcile a failed rollback.
    }
    throw error;
  }
}

export function renameNovelFile(id: number, title: string): boolean {
  if (!Number.isInteger(id) || id < 1) {
    throw new Error("小说不存在");
  }
  const normalizedTitle = normalizeNovelTitle(title);
  const db = getDb();
  const novel = db
    .prepare("SELECT id, title, file_name, relative_path, content_hash, storage_mode FROM novels WHERE id = ?")
    .get(id) as ExistingNovel | undefined;
  if (!novel) {
    throw new Error("小说不存在");
  }

  const currentPath = resolveLibraryFile(novel.relative_path);
  const extension = novel.storage_mode === "chapters" ? "" : path.extname(novel.file_name) || ".txt";
  const nextFileName = `${normalizedTitle}${extension}`;
  const normalizedRelativePath = novel.relative_path.replace(/\\/g, "/");
  const parentPath = path.posix.dirname(normalizedRelativePath);
  const nextRelativePath = parentPath === "." ? nextFileName : path.posix.join(parentPath, nextFileName);
  const nextPath = resolveLibraryFile(nextRelativePath);
  if (novel.title === normalizedTitle && novel.relative_path === nextRelativePath) {
    return false;
  }

  const samePath = currentPath.toLocaleLowerCase("en-US") === nextPath.toLocaleLowerCase("en-US");
  if (!samePath && fs.existsSync(nextPath)) {
    throw new Error("小说目录中已存在同名文件");
  }

  let moved = false;
  try {
    if (currentPath !== nextPath) {
      if (samePath) {
        const temporaryPath = `${currentPath}.${process.pid}.${Date.now()}.rename`;
        fs.renameSync(currentPath, temporaryPath);
        try {
          fs.renameSync(temporaryPath, nextPath);
        } catch (error) {
          fs.renameSync(temporaryPath, currentPath);
          throw error;
        }
      } else {
        fs.renameSync(currentPath, nextPath);
      }
      moved = true;
    }

    invalidateNovelContentSearchIndex(id, db);
    if (novel.storage_mode === "chapters") {
      db.exec("BEGIN");
      try {
        db.prepare(
          `UPDATE novels
           SET title = ?, file_name = ?, relative_path = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(normalizedTitle, nextFileName, nextRelativePath, id);
        db.prepare(
          `UPDATE novel_chapters
           SET relative_path = ? || substr(relative_path, ?), updated_at = CURRENT_TIMESTAMP
           WHERE novel_id = ? AND relative_path LIKE ?`,
        ).run(nextRelativePath, normalizedRelativePath.length + 1, id, `${normalizedRelativePath}/%`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    } else {
      const fileStat = fs.statSync(nextPath);
      db.prepare(
        `UPDATE novels
         SET title = ?, file_name = ?, relative_path = ?, size_bytes = ?, mtime_ms = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      ).run(normalizedTitle, nextFileName, nextRelativePath, fileStat.size, Math.round(fileStat.mtimeMs), id);
    }
    invalidateContentSearchResultCache();
    return true;
  } catch (error) {
    if (moved) {
      try {
        fs.renameSync(nextPath, currentPath);
      } catch {
        // Keep the original error; the scanner can reconcile a failed rollback.
      }
    }
    throw error;
  }
}

export function sanitizeNovelFileName(fileName: string): string | null {
  const baseName = path.basename(fileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  if (!baseName || !isNovelTextFile(baseName)) {
    return null;
  }
  return baseName;
}

export function sanitizeNovelRelativePath(relativePath: string): string | null {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  const segments = normalized.split("/");
  if (!segments.length || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }
  const fileName = sanitizeNovelFileName(segments.at(-1) || "");
  if (!fileName) return null;
  return [...segments.slice(0, -1), fileName].join("/");
}

function createUniqueRelativePath(fileName: string, relativeDirectory = ""): string {
  const parsed = path.posix.parse(fileName);
  let candidate = relativeDirectory ? path.posix.join(relativeDirectory, fileName) : fileName;
  let index = 2;

  while (fs.existsSync(resolveLibraryFile(candidate))) {
    const nextFileName = `${parsed.name}-${index}${parsed.ext}`;
    candidate = relativeDirectory ? path.posix.join(relativeDirectory, nextFileName) : nextFileName;
    index += 1;
  }

  return candidate;
}

export function buildNovelRecordFromRelativeFile(relativePath: string): SkippedNovelResult | NovelFileRecord {
  const safeRelativePath = sanitizeNovelRelativePath(relativePath);
  if (!safeRelativePath) {
    return { status: "skipped", fileName: relativePath, reason: "只支持小说目录内的 .txt 文件" };
  }
  const safeFileName = path.posix.basename(safeRelativePath);

  const title = parseNovelTitle(safeFileName);
  if (!title) {
    return { status: "skipped", fileName: safeFileName, reason: "文件名解析后的标题为空" };
  }

  const fullPath = resolveLibraryFile(safeRelativePath);
  const buffer = fs.readFileSync(fullPath);
  const fileStat = fs.statSync(fullPath);

  return {
    title,
    fileName: safeFileName,
    relativePath: safeRelativePath,
    contentHash: hashNovelBuffer(buffer),
    sizeBytes: fileStat.size,
    mtimeMs: Math.round(fileStat.mtimeMs),
    wordCount: countNovelWords(buffer),
  };
}

export function buildNovelRecordFromFile(fileName: string): SkippedNovelResult | NovelFileRecord {
  return buildNovelRecordFromRelativeFile(fileName);
}

export function findDuplicateNovel(
  db: DatabaseSync,
  title: string,
  contentHash: string,
  relativePath?: string,
  sourceId?: number | null,
): ExistingNovel | null {
  const sourceClause = sourceId === undefined ? "" : " AND source_id IS ?";
  const sql = relativePath
    ? `SELECT id, title, file_name, relative_path, content_hash
       FROM novels
       WHERE title = ? AND content_hash = ? AND relative_path != ?${sourceClause}
       ORDER BY id ASC
       LIMIT 1`
    : `SELECT id, title, file_name, relative_path, content_hash
       FROM novels
       WHERE title = ? AND content_hash = ?${sourceClause}
       ORDER BY id ASC
       LIMIT 1`;
  const params: Array<string | number | null> = relativePath ? [title, contentHash, relativePath] : [title, contentHash];
  if (sourceId !== undefined) params.push(sourceId);
  const duplicate = db.prepare(sql).get(...params) as ExistingNovel | undefined;

  return duplicate || null;
}

export function upsertNovelRecord(db: DatabaseSync, record: NovelFileRecord): number {
  const sourceId = record.sourceId ?? (db.prepare(
    "SELECT id FROM novel_sources WHERE relative_path = '' LIMIT 1",
  ).get() as { id: number } | undefined)?.id ?? null;
  const existing = db
    .prepare("SELECT id, content_hash, size_bytes, mtime_ms FROM novels WHERE relative_path = ?")
    .get(record.relativePath) as { id: number; content_hash: string | null; size_bytes: number; mtime_ms: number } | undefined;
  if (
    existing &&
    (existing.content_hash !== record.contentHash || existing.size_bytes !== record.sizeBytes || existing.mtime_ms !== record.mtimeMs)
  ) {
    invalidateNovelContentSearchIndex(existing.id, db);
  }

  const result = db.prepare(
    `INSERT INTO novels (
       title, file_name, relative_path, source_id, storage_mode, chapter_count,
       content_hash, size_bytes, mtime_ms, word_count, updated_at
     )
     VALUES (@title, @fileName, @relativePath, @sourceId, 'single', 0, @contentHash, @sizeBytes, @mtimeMs, @wordCount, CURRENT_TIMESTAMP)
     ON CONFLICT(relative_path) DO UPDATE SET
       title = excluded.title,
       file_name = excluded.file_name,
       source_id = excluded.source_id,
       storage_mode = 'single',
       chapter_count = 0,
        content_hash = excluded.content_hash,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        word_count = excluded.word_count,
        updated_at = CURRENT_TIMESTAMP
      WHERE novels.title IS NOT excluded.title
         OR novels.file_name IS NOT excluded.file_name
         OR novels.source_id IS NOT excluded.source_id
         OR novels.storage_mode IS NOT excluded.storage_mode
         OR novels.chapter_count IS NOT excluded.chapter_count
         OR novels.content_hash IS NOT excluded.content_hash
         OR novels.size_bytes IS NOT excluded.size_bytes
         OR novels.mtime_ms IS NOT excluded.mtime_ms
         OR novels.word_count IS NOT excluded.word_count`,
  ).run({ ...record, sourceId });
  if (result.changes > 0) {
    invalidateContentSearchResultCache();
    invalidateNovelIdCache();
  }

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

  invalidateNovelContentSearchIndex(row.id, db);
  db.prepare("DELETE FROM novels WHERE id = ?").run(row.id);
  invalidateContentSearchResultCache();
  invalidateNovelIdCache();
  return true;
}

export function deleteNovelById(db: DatabaseSync, id: number): DeletedNovel | null {
  const novel = db
    .prepare("SELECT id, title, file_name, relative_path, content_hash, storage_mode FROM novels WHERE id = ?")
    .get(id) as ExistingNovel | undefined;

  if (!novel) {
    return null;
  }

  const filePath = resolveLibraryFile(novel.relative_path);
  db.exec("BEGIN");
  try {
    invalidateNovelContentSearchIndex(id, db);
    db.prepare("DELETE FROM novels WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  let fileDeleteFailed = false;
  if (fs.existsSync(filePath)) {
    try {
      if (novel.storage_mode === "chapters") fs.rmSync(filePath, { recursive: true });
      else fs.unlinkSync(filePath);
    } catch {
      fileDeleteFailed = true;
    }
  }

  invalidateContentSearchResultCache();
  invalidateNovelIdCache();

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

export async function saveUploadedNovels(files: File[], sourceIdValue?: number): Promise<SavedNovelResult[]> {
  const db = getDb();
  const libraryRoot = getLibraryRoot();
  fs.mkdirSync(libraryRoot, { recursive: true });
  const results: SavedNovelResult[] = [];
  const requestedSourceId = Number(sourceIdValue || 0);
  const source = Number.isInteger(requestedSourceId) && requestedSourceId > 0
    ? db.prepare("SELECT id, slug, relative_path FROM novel_sources WHERE id = ?").get(requestedSourceId)
    : db.prepare("SELECT id, slug, relative_path FROM novel_sources WHERE slug = 'default' LIMIT 1").get();
  if (!source) throw new Error("小说来源不存在");
  const uploadSource = source as { id: number; slug: string; relative_path: string };
  const sourceRelativePath = getNovelSourceStoragePath({
    slug: uploadSource.slug,
    relativePath: uploadSource.relative_path,
  });
  if (sourceRelativePath && sourceRelativePath.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("小说来源目录无效");
  }
  if (sourceRelativePath) fs.mkdirSync(resolveLibraryFile(sourceRelativePath), { recursive: true });

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
    const duplicate = findDuplicateNovel(db, title, contentHash, undefined, uploadSource.id);
    if (duplicate) {
      if (fs.existsSync(resolveLibraryFile(duplicate.relative_path))) {
        results.push({ status: "duplicate", title, fileName, keptFileName: duplicate.file_name });
        continue;
      }
      deleteNovelByRelativePath(db, duplicate.relative_path);
    }

    const relativePath = createUniqueRelativePath(fileName, sourceRelativePath);
    const uniqueFileName = path.posix.basename(relativePath);
    const filePath = resolveLibraryFile(relativePath);
    fs.writeFileSync(filePath, buffer, { flag: "wx" });
    let id: number;
    try {
      const fileStat = fs.statSync(filePath);
      id = upsertNovelRecord(db, {
        title,
        fileName: uniqueFileName,
        relativePath,
        contentHash,
        sizeBytes: fileStat.size,
        mtimeMs: Math.round(fileStat.mtimeMs),
        wordCount: countNovelWords(buffer),
        sourceId: uploadSource.id,
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

type PreparedChapterUpload = {
  fileName: string;
  title: string;
  buffer: Buffer;
  contentHash: string;
  wordCount: number;
};

async function prepareChapterUploads(files: File[]): Promise<PreparedChapterUpload[]> {
  const sorted = [...files].sort((left, right) => chapterNameCollator.compare(left.name, right.name));
  const usedNames = new Set<string>();
  const chapters: PreparedChapterUpload[] = [];

  for (const file of sorted) {
    const sanitized = sanitizeNovelFileName(file.name);
    if (!sanitized) throw new Error(`“${file.name || "未命名文件"}”不是有效的 TXT 章节`);
    const parsed = path.posix.parse(sanitized);
    let fileName = sanitized;
    let suffix = 2;
    while (usedNames.has(fileName.toLocaleLowerCase("en-US"))) {
      fileName = `${parsed.name}-${suffix}${parsed.ext}`;
      suffix += 1;
    }
    usedNames.add(fileName.toLocaleLowerCase("en-US"));
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) throw new Error(`章节“${file.name}”为空`);
    chapters.push({
      fileName,
      title: parseNovelTitle(fileName) || parsed.name,
      buffer,
      contentHash: hashNovelBuffer(buffer),
      wordCount: countNovelWords(buffer),
    });
  }

  if (!chapters.length) throw new Error("请选择至少一个 TXT 章节");
  return chapters;
}

function createUniqueRelativeDirectory(directoryName: string, parentRelativePath: string): string {
  let suffix = 1;
  while (true) {
    const name = suffix === 1 ? directoryName : `${directoryName}-${suffix}`;
    const relativePath = parentRelativePath ? path.posix.join(parentRelativePath, name) : name;
    if (!fs.existsSync(resolveLibraryFile(relativePath))) return relativePath;
    suffix += 1;
  }
}

function resolveChapterUploadSource(sourceIdValue: number | undefined): {
  id: number;
  relativePath: string;
} {
  const db = getDb();
  const sourceId = Number(sourceIdValue || 0);
  if (Number.isInteger(sourceId) && sourceId > 0) {
    const source = db.prepare("SELECT id, slug, relative_path FROM novel_sources WHERE id = ?").get(sourceId) as {
      id: number;
      slug: string;
      relative_path: string;
    } | undefined;
    if (source) {
      return {
        id: source.id,
        relativePath: getNovelSourceStoragePath({ slug: source.slug, relativePath: source.relative_path }),
      };
    }
  }
  throw new Error("小说来源不存在");
}

function chapterAggregateHash(chapters: Array<{ relativePath: string; contentHash: string }>): string {
  const hash = crypto.createHash("sha256");
  for (const chapter of chapters) {
    hash.update(chapter.relativePath).update("\0").update(chapter.contentHash).update("\0");
  }
  return hash.digest("hex");
}

function refreshChapterNovelAggregate(db: DatabaseSync, novelId: number) {
  const chapters = db.prepare(
    `SELECT relative_path, content_hash, size_bytes, mtime_ms, word_count
     FROM novel_chapters
     WHERE novel_id = ?
     ORDER BY COALESCE(sort_override, sort_order) ASC, id ASC`,
  ).all(novelId) as Array<{
    relative_path: string;
    content_hash: string | null;
    size_bytes: number;
    mtime_ms: number;
    word_count: number;
  }>;
  db.prepare(
    `UPDATE novels
     SET chapter_count = ?, content_hash = ?, size_bytes = ?, mtime_ms = ?, word_count = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND storage_mode = 'chapters'`,
  ).run(
    chapters.length,
    chapterAggregateHash(chapters.map((chapter) => ({
      relativePath: chapter.relative_path,
      contentHash: chapter.content_hash || "",
    }))),
    chapters.reduce((total, chapter) => total + chapter.size_bytes, 0),
    chapters.reduce((latest, chapter) => Math.max(latest, chapter.mtime_ms), 0),
    chapters.reduce((total, chapter) => total + chapter.word_count, 0),
    novelId,
  );
}

export async function saveUploadedChapterNovel(input: {
  title: string;
  files: File[];
  sourceId?: number;
}): Promise<SavedChapterNovelResult> {
  const title = normalizeNovelTitle(input.title);
  const chapters = await prepareChapterUploads(input.files);
  const db = getDb();
  const source = resolveChapterUploadSource(input.sourceId);
  fs.mkdirSync(resolveLibraryFile(source.relativePath), { recursive: true });
  const finalRelativePath = createUniqueRelativeDirectory(title, source.relativePath);
  const finalPath = resolveLibraryFile(finalRelativePath);
  const stagingRelativePath = path.posix.join(source.relativePath, `.upload-${crypto.randomUUID()}`);
  const stagingPath = resolveLibraryFile(stagingRelativePath);
  fs.mkdirSync(stagingPath, { recursive: false });

  try {
    for (const chapter of chapters) {
      fs.writeFileSync(path.join(stagingPath, chapter.fileName), chapter.buffer, { flag: "wx" });
    }
    fs.renameSync(stagingPath, finalPath);

    db.exec("BEGIN IMMEDIATE");
    try {
      const stats = chapters.map((chapter) => fs.statSync(path.join(finalPath, chapter.fileName)));
      const chapterRecords = chapters.map((chapter, index) => ({
        ...chapter,
        relativePath: path.posix.join(finalRelativePath, chapter.fileName),
        sizeBytes: stats[index].size,
        mtimeMs: Math.round(stats[index].mtimeMs),
      }));
      const result = db.prepare(
        `INSERT INTO novels (
           title, file_name, relative_path, source_id, storage_mode, chapter_count,
           content_hash, size_bytes, mtime_ms, word_count, updated_at
         ) VALUES (?, ?, ?, ?, 'chapters', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      ).run(
        title,
        path.posix.basename(finalRelativePath),
        finalRelativePath,
        source.id,
        chapterRecords.length,
        chapterAggregateHash(chapterRecords),
        chapterRecords.reduce((total, chapter) => total + chapter.sizeBytes, 0),
        Math.max(...chapterRecords.map((chapter) => chapter.mtimeMs)),
        chapterRecords.reduce((total, chapter) => total + chapter.wordCount, 0),
      );
      const novelId = Number(result.lastInsertRowid);
      const insertChapter = db.prepare(
        `INSERT INTO novel_chapters (
           novel_id, title, relative_path, sort_order, content_hash, size_bytes, mtime_ms, word_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      chapterRecords.forEach((chapter, index) => insertChapter.run(
        novelId,
        chapter.title,
        chapter.relativePath,
        index,
        chapter.contentHash,
        chapter.sizeBytes,
        chapter.mtimeMs,
        chapter.wordCount,
      ));
      db.exec("COMMIT");
      invalidateContentSearchResultCache();
      invalidateNovelIdCache();
      return { id: novelId, title, chapters: chapterRecords.length };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    try {
      fs.rmSync(fs.existsSync(finalPath) ? finalPath : stagingPath, { recursive: true, force: true });
    } catch {
      // Keep the upload error; a hidden staging directory is ignored by the scanner.
    }
    throw error;
  }
}

export async function appendUploadedNovelChapters(novelId: number, files: File[]): Promise<number> {
  if (!Number.isInteger(novelId) || novelId < 1) throw new Error("小说不存在");
  const chapters = await prepareChapterUploads(files);
  const db = getDb();
  const novel = db.prepare(
    "SELECT relative_path, storage_mode FROM novels WHERE id = ?",
  ).get(novelId) as { relative_path: string; storage_mode: string } | undefined;
  if (!novel || novel.storage_mode !== "chapters") throw new Error("这不是章节小说");
  const novelPath = resolveLibraryFile(novel.relative_path);
  const existingNames = new Set(
    fs.readdirSync(novelPath).map((name) => name.toLocaleLowerCase("en-US")),
  );
  const written: Array<PreparedChapterUpload & { finalPath: string; relativePath: string }> = [];

  try {
    for (const chapter of chapters) {
      const parsed = path.posix.parse(chapter.fileName);
      let fileName = chapter.fileName;
      let suffix = 2;
      while (existingNames.has(fileName.toLocaleLowerCase("en-US"))) {
        fileName = `${parsed.name}-${suffix}${parsed.ext}`;
        suffix += 1;
      }
      existingNames.add(fileName.toLocaleLowerCase("en-US"));
      const finalPath = path.join(novelPath, fileName);
      const temporaryPath = `${finalPath}.${crypto.randomUUID()}.upload`;
      fs.writeFileSync(temporaryPath, chapter.buffer, { flag: "wx" });
      fs.renameSync(temporaryPath, finalPath);
      written.push({ ...chapter, fileName, finalPath, relativePath: path.posix.join(novel.relative_path, fileName) });
    }

    db.exec("BEGIN IMMEDIATE");
    try {
      const position = db.prepare(
        "SELECT COALESCE(MAX(COALESCE(sort_override, sort_order)), -1) AS value FROM novel_chapters WHERE novel_id = ?",
      ).get(novelId) as { value: number };
      const insert = db.prepare(
        `INSERT INTO novel_chapters (
           novel_id, title, relative_path, sort_order, sort_override, content_hash, size_bytes, mtime_ms, word_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      written.forEach((chapter, index) => {
        const stat = fs.statSync(chapter.finalPath);
        const sortOrder = position.value + index + 1;
        insert.run(
          novelId,
          chapter.title,
          chapter.relativePath,
          sortOrder,
          sortOrder,
          chapter.contentHash,
          stat.size,
          Math.round(stat.mtimeMs),
          chapter.wordCount,
        );
      });
      refreshChapterNovelAggregate(db, novelId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    for (const chapter of written) {
      try {
        fs.rmSync(chapter.finalPath, { force: true });
      } catch {
        // Preserve the original upload error.
      }
    }
    throw error;
  }

  invalidateNovelContentSearchIndex(novelId, db);
  invalidateContentSearchResultCache();
  return written.length;
}

export function deleteNovelChapterIds(novelId: number, chapterIds: number[]): number {
  const ids = Array.from(new Set(chapterIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!Number.isInteger(novelId) || novelId < 1 || !ids.length) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(", ");
  const chapters = db.prepare(
    `SELECT id, relative_path FROM novel_chapters WHERE novel_id = ? AND id IN (${placeholders})`,
  ).all(novelId, ...ids) as Array<{ id: number; relative_path: string }>;
  const total = db.prepare("SELECT COUNT(*) AS count FROM novel_chapters WHERE novel_id = ?")
    .get(novelId) as { count: number };
  if (!chapters.length) return 0;
  if (chapters.length >= total.count) throw new Error("章节小说至少保留一个章节；如需清空，请删除整本小说");

  const moved: Array<{ original: string; temporary: string }> = [];
  try {
    for (const chapter of chapters) {
      const original = resolveLibraryFile(chapter.relative_path);
      if (!fs.existsSync(original)) continue;
      const temporary = `${original}.${crypto.randomUUID()}.delete`;
      fs.renameSync(original, temporary);
      moved.push({ original, temporary });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`DELETE FROM novel_chapters WHERE novel_id = ? AND id IN (${placeholders})`).run(novelId, ...ids);
      refreshChapterNovelAggregate(db, novelId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } catch (error) {
    for (const file of moved.reverse()) {
      try {
        fs.renameSync(file.temporary, file.original);
      } catch {
        // Keep the database or filesystem error; the scanner can reconcile the directory.
      }
    }
    throw error;
  }

  for (const file of moved) fs.rmSync(file.temporary, { force: true });
  invalidateNovelContentSearchIndex(novelId, db);
  invalidateContentSearchResultCache();
  return chapters.length;
}
