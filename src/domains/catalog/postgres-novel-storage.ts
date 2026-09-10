import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { normalizeChineseSearchForms } from "@/domains/reading/content-text";
import { publishPostgresContent } from "@/domains/reading/postgres-content";
import { getLibraryDir } from "@/lib/config";
import { isNovelTextFile, parseNovelTitle } from "@/lib/filename";
import { decodeNovelBuffer } from "@/lib/text";
import {
  chapterAggregateHash,
  getNovelSourceStoragePath,
  getPostgresAdminNovel,
  getPostgresAdminNovelSource,
  type NovelChapterUpdate,
} from "./postgres-admin-novels";

const INVALID_NAME = /[<>:"/\\|?*\x00-\x1f]/u;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const chapterCollator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export type SavedNovelResult =
  | { status: "saved"; title: string; fileName: string; id: number }
  | { status: "duplicate"; title: string; fileName: string; keptFileName: string }
  | { status: "skipped"; fileName: string; reason: string };
export type SavedChapterNovelResult = { id: number; title: string; chapters: number };
export type DeleteNovelSummary = { deleted: number; fileDeleteFailures: string[] };

type PreparedChapter = Readonly<{
  fileName: string;
  title: string;
  buffer: Buffer;
  contentHash: string;
  wordCount: number;
}>;

type StoredChapter = PreparedChapter & Readonly<{
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
}>;

type InsertedChapter = StoredChapter & Readonly<{ id: number }>;
type ChapterHashRow = QueryResultRow & {
  relative_path: string;
  content_hash: string | null;
  size_bytes: string | number;
  mtime_ms: string | number;
  word_count: string | number;
};

function libraryRoot(): string {
  return path.resolve(getLibraryDir());
}

function normalizedRelativePath(value: string, allowRoot = false): string {
  const normalized = value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
  if ((!normalized && !allowRoot) || normalized.split("/").some((part) => part === "." || part === "..")) {
    throw new Error("小说文件路径无效");
  }
  const root = libraryRoot();
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("小说文件路径不在小说目录内");
  return normalized;
}

function libraryPath(relativePath: string, allowRoot = false): string {
  return path.resolve(libraryRoot(), normalizedRelativePath(relativePath, allowRoot));
}

function positiveId(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) throw new Error(`${label}无效`);
  return parsed;
}

function nonnegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`PostgreSQL 返回了无效的${label}`);
  return parsed;
}

function normalizeTitle(value: string): string {
  const title = value.normalize("NFKC").trim();
  if (!title || Array.from(title).length > 120) throw new Error("小说名称应为 1 到 120 个字符");
  if (INVALID_NAME.test(title) || RESERVED_NAME.test(title) || /[. ]$/u.test(title)) {
    throw new Error("小说名称包含文件名不支持的字符");
  }
  return title;
}

function normalizeSourceName(value: string): string {
  const name = value.normalize("NFKC").trim();
  if (!name || Array.from(name).length > 120) throw new Error("来源名称应为 1 到 120 个字符");
  return name;
}

function normalizeFolder(value: string): string {
  const folder = value.normalize("NFKC").trim();
  if (!folder || Array.from(folder).length > 120 || folder.toLocaleLowerCase("en-US") === "default"
      || INVALID_NAME.test(folder) || RESERVED_NAME.test(folder) || /[. ]$/u.test(folder)
      || folder === "." || folder === "..") {
    throw new Error("来源文件夹名称无效或已被系统保留");
  }
  return folder;
}

function contentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function contentWordCount(buffer: Buffer): number {
  return Array.from(decodeNovelBuffer(buffer).replace(/\s+/gu, "")).length;
}

function sourceSlug(relativePath: string): string {
  const readable = relativePath.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 54);
  return `${readable || "source"}-${contentHash(Buffer.from(relativePath)).slice(0, 8)}`;
}

function sanitizeFileName(input: string): string | null {
  const base = path.basename(input).replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_").trim();
  return base && isNovelTextFile(base) ? base : null;
}

async function writeNewFile(target: string, buffer: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, buffer, { flag: "wx" });
}

async function replaceFileAtomically(target: string, buffer: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const token = randomUUID();
  const temporary = `${target}.${token}.upload`;
  const backup = `${target}.${token}.backup`;
  let movedOriginal = false;
  try {
    await fs.writeFile(temporary, buffer, { flag: "wx" });
    try {
      await fs.rename(target, backup);
      movedOriginal = true;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (code !== "ENOENT") throw error;
    }
    await fs.rename(temporary, target);
    if (movedOriginal) await fs.rm(backup, { force: true });
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    if (movedOriginal) {
      await fs.rm(target, { force: true }).catch(() => undefined);
      await fs.rename(backup, target).catch(() => undefined);
    }
    throw error;
  }
}

async function reserveUniqueFile(directory: string, fileName: string, buffer: Buffer): Promise<string> {
  const parsed = path.parse(fileName);
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = suffix === 1 ? fileName : `${parsed.name}-${suffix}${parsed.ext}`;
    try {
      await writeNewFile(path.join(directory, candidate), buffer);
      return candidate;
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (code !== "EEXIST") throw error;
    }
  }
  throw new Error("同名文件过多，请修改文件名后重试");
}

async function reserveUniqueDirectory(parent: string, title: string): Promise<{ name: string; path: string }> {
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const name = suffix === 1 ? title : `${title}-${suffix}`;
    const directory = path.join(parent, name);
    try {
      await fs.mkdir(directory);
      return { name, path: directory };
    } catch (error) {
      const code = error instanceof Error && "code" in error ? error.code : null;
      if (code !== "EEXIST") throw error;
    }
  }
  throw new Error("同名小说目录过多，请修改小说名后重试");
}

export async function createPostgresNovelSource(input: { folderName: string; name?: string }): Promise<number> {
  const relativePath = normalizeFolder(input.folderName);
  const name = normalizeSourceName(input.name?.trim() || relativePath);
  const executor = database("web");
  const duplicate = await executor.query({
    text: "SELECT id FROM novel_sources WHERE lower(relative_path) = lower($1)",
    values: [relativePath],
  });
  if (duplicate.rowCount) throw new Error("该来源文件夹已在管理列表中");

  const target = libraryPath(relativePath);
  let createdDirectory = false;
  try {
    await fs.mkdir(target);
    createdDirectory = true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : null;
    if (code !== "EEXIST" || !(await fs.stat(target)).isDirectory()) throw error;
  }
  try {
    return await withTransaction(async (tx) => {
      const result = await tx.query<{ id: string | number }>({
        text: `INSERT INTO novel_sources (slug, name, relative_path, sort_order)
          VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 10 FROM novel_sources), 0))
          RETURNING id`,
        values: [sourceSlug(relativePath), name, relativePath],
      });
      return positiveId(result.rows[0]?.id, "小说来源");
    }, { isolation: "serializable", lockTimeoutMs: 2_000 });
  } catch (error) {
    if (createdDirectory) await fs.rmdir(target).catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new Error("该来源文件夹已在管理列表中");
    }
    throw error;
  }
}

export async function updatePostgresNovelSourceSettings(
  sourceIdValue: number,
  input: { name: string; sortOrder: number },
): Promise<void> {
  const sourceId = positiveId(sourceIdValue, "小说来源");
  const sortOrder = Math.min(Math.max(Math.floor(Number(input.sortOrder) || 0), -10_000), 10_000);
  const result = await database("web").query({
    text: "UPDATE novel_sources SET name = $2, sort_order = $3, updated_at = clock_timestamp() WHERE id = $1",
    values: [sourceId, normalizeSourceName(input.name), sortOrder],
  });
  if (!result.rowCount) throw new Error("小说来源不存在");
}

export async function deletePostgresEmptyNovelSource(sourceIdValue: number): Promise<void> {
  const sourceId = positiveId(sourceIdValue, "小说来源");
  const source = await getPostgresAdminNovelSource(database("web"), sourceId);
  if (!source) throw new Error("小说来源不存在");
  if (source.slug.toLocaleLowerCase("en-US") === "default") throw new Error("默认来源不能删除");
  if (source.novelCount > 0) throw new Error("该来源仍有小说，不能删除");
  const target = libraryPath(getNovelSourceStoragePath(source));
  const stat = await fs.stat(target).catch(() => null);
  if (stat && (!stat.isDirectory() || (await fs.readdir(target)).length > 0)) {
    throw new Error("来源文件夹不为空，请先扫描或处理其中内容");
  }
  await withTransaction(async (tx) => {
    const result = await tx.query({
      text: "DELETE FROM novel_sources WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM novels WHERE source_id = $1)",
      values: [sourceId],
    });
    if (!result.rowCount) throw new Error("来源已被修改，请刷新后重试");
  }, { isolation: "serializable", lockTimeoutMs: 2_000 });
  if (stat) await fs.rmdir(target).catch(() => undefined);
}

async function sourceForUpload(sourceIdValue?: number): Promise<{ id: number; relativePath: string }> {
  const executor = database("web");
  const sourceId = Number(sourceIdValue);
  if (Number.isSafeInteger(sourceId) && sourceId > 0) {
    const source = await getPostgresAdminNovelSource(executor, sourceId);
    if (!source) throw new Error("小说来源不存在");
    return { id: source.id, relativePath: normalizedRelativePath(getNovelSourceStoragePath(source), true) };
  }
  const result = await executor.query<{ id: string | number; relative_path: string }>({
    text: "SELECT id, relative_path FROM novel_sources WHERE lower(slug) = 'default' LIMIT 1",
  });
  const row = result.rows[0];
  if (!row) throw new Error("默认小说来源不存在，请先初始化 PostgreSQL");
  return { id: positiveId(row.id, "小说来源"), relativePath: normalizedRelativePath(row.relative_path, true) };
}

async function prepareChapterFiles(files: File[]): Promise<PreparedChapter[]> {
  const output: PreparedChapter[] = [];
  const used = new Set<string>();
  for (const file of [...files].sort((left, right) => chapterCollator.compare(left.name, right.name))) {
    const sanitized = sanitizeFileName(file.name);
    if (!sanitized) throw new Error(`“${file.name || "未命名文件"}”不是有效的 TXT 章节`);
    const parsed = path.parse(sanitized);
    let fileName = sanitized;
    for (let suffix = 2; used.has(fileName.toLocaleLowerCase("en-US")); suffix += 1) {
      fileName = `${parsed.name}-${suffix}${parsed.ext}`;
    }
    used.add(fileName.toLocaleLowerCase("en-US"));
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) throw new Error(`章节“${file.name}”为空`);
    output.push({ fileName, title: parseNovelTitle(fileName) || parsed.name, buffer,
      contentHash: contentHash(buffer), wordCount: contentWordCount(buffer) });
  }
  if (!output.length) throw new Error("请选择至少一个 TXT 章节");
  return output;
}

async function storeChapterFiles(directory: string, relativeDirectory: string, chapters: readonly PreparedChapter[]): Promise<StoredChapter[]> {
  const stored: StoredChapter[] = [];
  try {
    for (const chapter of chapters) {
      const fileName = await reserveUniqueFile(directory, chapter.fileName, chapter.buffer);
      const absolutePath = path.join(directory, fileName);
      const stat = await fs.stat(absolutePath);
      stored.push({ ...chapter, fileName, relativePath: path.posix.join(relativeDirectory, fileName),
        sizeBytes: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
    }
    return stored;
  } catch (error) {
    await Promise.all(stored.map((chapter) => fs.rm(libraryPath(chapter.relativePath), { force: true })));
    throw error;
  }
}

async function publishInsertedChapter(chapter: InsertedChapter, novelId: number): Promise<void> {
  await publishPostgresContent({ novelId, chapterId: chapter.id, sourceContentVersion: chapter.contentHash,
    expectedPublishedVersion: null, text: decodeNovelBuffer(chapter.buffer) });
}

export async function savePostgresUploadedNovels(files: File[], sourceIdValue?: number): Promise<SavedNovelResult[]> {
  const source = await sourceForUpload(sourceIdValue);
  const directory = libraryPath(source.relativePath, true);
  await fs.mkdir(directory, { recursive: true });
  const executor = database("web");
  const results: SavedNovelResult[] = [];
  for (const file of files) {
    const requestedName = sanitizeFileName(file.name);
    if (!requestedName) {
      results.push({ status: "skipped", fileName: file.name || "unknown", reason: "只支持 .txt 小说文件" });
      continue;
    }
    const title = parseNovelTitle(requestedName);
    if (!title) {
      results.push({ status: "skipped", fileName: requestedName, reason: "文件名解析后的标题为空" });
      continue;
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length) {
      results.push({ status: "skipped", fileName: requestedName, reason: "文件为空" });
      continue;
    }
    const hash = contentHash(buffer);
    const duplicate = await executor.query<{ file_name: string; relative_path: string }>({
      text: `SELECT file_name, relative_path FROM novels
        WHERE source_id = $1 AND title = $2 AND content_hash = $3 ORDER BY id LIMIT 1`,
      values: [source.id, title, hash],
    });
    if (duplicate.rows[0] && await fs.stat(libraryPath(duplicate.rows[0].relative_path)).then(
      (stat) => stat.isFile(), () => false,
    )) {
      results.push({ status: "duplicate", title, fileName: requestedName, keptFileName: duplicate.rows[0].file_name });
      continue;
    }
    const fileName = await reserveUniqueFile(directory, requestedName, buffer);
    const relativePath = path.posix.join(source.relativePath, fileName);
    const target = libraryPath(relativePath);
    try {
      const [forms, stat] = await Promise.all([normalizeChineseSearchForms(title, "title"), fs.stat(target)]);
      const inserted = await executor.query<{ id: string | number }>({
        text: `INSERT INTO novels (
          title,title_search_original,title_search_hans,normalization_version,file_name,relative_path,
          source_id,storage_mode,content_hash,size_bytes,mtime_ms,word_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'single',$8,$9,$10,$11) RETURNING id`,
        values: [title, forms.original, forms.hans, forms.version, fileName, relativePath,
          source.id, hash, stat.size, Math.round(stat.mtimeMs), contentWordCount(buffer)],
      });
      const id = positiveId(inserted.rows[0]?.id, "小说");
      try {
        await publishPostgresContent({ novelId: id, chapterId: null, sourceContentVersion: hash,
          expectedPublishedVersion: null, text: decodeNovelBuffer(buffer) });
      } catch (error) {
        const removed = await executor.query({
          text: `DELETE FROM novels WHERE id = $1 AND content_hash = $2
            AND published_content_version IS NULL`,
          values: [id, hash],
        }).catch(() => null);
        if (removed?.rowCount) await fs.rm(target, { force: true }).catch(() => undefined);
        else {
          const current = await executor.query<{ published_content_version: string | null }>({
            text: "SELECT published_content_version FROM novels WHERE id = $1 AND content_hash = $2",
            values: [id, hash],
          }).catch(() => null);
          if (current?.rows[0]?.published_content_version === hash) {
            results.push({ status: "saved", title, fileName, id });
            continue;
          }
        }
        throw error;
      }
      results.push({ status: "saved", title, fileName, id });
    } catch (error) {
      const exists = await executor.query({ text: "SELECT 1 FROM novels WHERE relative_path = $1", values: [relativePath] })
        .then((result) => Boolean(result.rowCount), () => true);
      if (!exists) await fs.rm(target, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  return results;
}

async function insertChapterNovel(
  sourceId: number,
  title: string,
  directoryName: string,
  relativeDirectory: string,
  chapters: readonly StoredChapter[],
): Promise<{ novelId: number; chapters: InsertedChapter[] }> {
  const forms = await normalizeChineseSearchForms(title, "title");
  const aggregate = chapterAggregateHash(chapters.map((chapter) => ({
    relativePath: chapter.relativePath,
    contentHash: chapter.contentHash,
  })));
  return withTransaction(async (tx) => {
    const novel = await tx.query<{ id: string | number }>({
      text: `INSERT INTO novels (
        title,title_search_original,title_search_hans,normalization_version,file_name,relative_path,
        source_id,storage_mode,chapter_count,content_hash,size_bytes,mtime_ms,word_count)
        VALUES ($1,$2,$3,$4,$5,$6,$7,'chapters',$8,$9,$10,$11,$12) RETURNING id`,
      values: [title, forms.original, forms.hans, forms.version, directoryName, relativeDirectory,
        sourceId, chapters.length, aggregate, chapters.reduce((sum, chapter) => sum + chapter.sizeBytes, 0),
        Math.max(...chapters.map((chapter) => chapter.mtimeMs)),
        chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)],
    });
    const novelId = positiveId(novel.rows[0]?.id, "小说");
    const inserted = await tx.query<{ id: string | number; relative_path: string }>({
      text: `WITH input AS (
          SELECT * FROM jsonb_to_recordset($2::jsonb) AS value(
            title text, relative_path text, sort_order integer, content_hash text,
            size_bytes bigint, mtime_ms bigint, word_count integer)
        ) INSERT INTO novel_chapters (
          novel_id,title,relative_path,sort_order,content_hash,size_bytes,mtime_ms,word_count)
        SELECT $1,title,relative_path,sort_order,content_hash,size_bytes,mtime_ms,word_count FROM input
        RETURNING id, relative_path`,
      values: [novelId, JSON.stringify(chapters.map((chapter, index) => ({ title: chapter.title,
        relative_path: chapter.relativePath, sort_order: index, content_hash: chapter.contentHash,
        size_bytes: chapter.sizeBytes, mtime_ms: chapter.mtimeMs, word_count: chapter.wordCount })))],
    });
    const ids = new Map(inserted.rows.map((row) => [row.relative_path, positiveId(row.id, "章节")]));
    return { novelId, chapters: chapters.map((chapter) => {
      const id = ids.get(chapter.relativePath);
      if (!id) throw new Error("章节写入不完整");
      return { ...chapter, id };
    }) };
  }, { isolation: "serializable", lockTimeoutMs: 5_000 });
}

export async function savePostgresUploadedChapterNovel(input: {
  title: string;
  files: File[];
  sourceId?: number;
}): Promise<SavedChapterNovelResult> {
  const title = normalizeTitle(input.title);
  const prepared = await prepareChapterFiles(input.files);
  const source = await sourceForUpload(input.sourceId);
  const parent = libraryPath(source.relativePath, true);
  await fs.mkdir(parent, { recursive: true });
  const reserved = await reserveUniqueDirectory(parent, title);
  const relativeDirectory = path.posix.join(source.relativePath, reserved.name);
  let novelId: number | null = null;
  try {
    const stored = await storeChapterFiles(reserved.path, relativeDirectory, prepared);
    const inserted = await insertChapterNovel(source.id, title, reserved.name, relativeDirectory, stored);
    novelId = inserted.novelId;
    for (const chapter of inserted.chapters) await publishInsertedChapter(chapter, novelId);
    return { id: novelId, title, chapters: inserted.chapters.length };
  } catch (error) {
    let catalogRemoved = novelId === null;
    if (novelId !== null) {
      catalogRemoved = await database("web").query({ text: "DELETE FROM novels WHERE id = $1", values: [novelId] })
        .then((result) => Boolean(result.rowCount), () => false);
    }
    if (catalogRemoved) await fs.rm(reserved.path, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function recomputeChapterNovel(tx: SqlExecutor, novelId: number): Promise<void> {
  const result = await tx.query<ChapterHashRow>({
    text: `SELECT relative_path, content_hash, size_bytes, mtime_ms, word_count
      FROM novel_chapters WHERE novel_id = $1
      ORDER BY COALESCE(sort_override, sort_order), id`,
    values: [novelId],
  });
  if (!result.rowCount) throw new Error("章节小说至少保留一个章节");
  const hashes = result.rows.map((row) => {
    if (!row.content_hash) throw new Error("章节内容摘要缺失");
    return { relativePath: row.relative_path, contentHash: row.content_hash };
  });
  await tx.query({
    text: `UPDATE novels SET chapter_count=$2, content_hash=$3, size_bytes=$4,
      mtime_ms=$5, word_count=$6, updated_at=clock_timestamp() WHERE id=$1`,
    values: [novelId, result.rows.length, chapterAggregateHash(hashes),
      result.rows.reduce((sum, row) => sum + nonnegativeInteger(row.size_bytes, "章节大小"), 0),
      Math.max(...result.rows.map((row) => nonnegativeInteger(row.mtime_ms, "章节时间"))),
      result.rows.reduce((sum, row) => sum + nonnegativeInteger(row.word_count, "章节字数"), 0)],
  });
}

async function rollbackInsertedChapters(novelId: number, chapterIds: readonly number[]): Promise<boolean> {
  try {
    return await withTransaction(async (tx) => {
      await tx.query({ text: "SELECT id FROM novels WHERE id = $1 FOR UPDATE", values: [novelId] });
      const removed = await tx.query({
        text: "DELETE FROM novel_chapters WHERE novel_id = $1 AND id = ANY($2::integer[])",
        values: [novelId, chapterIds],
      });
      await recomputeChapterNovel(tx, novelId);
      return removed.rowCount === chapterIds.length;
    }, { isolation: "serializable", lockTimeoutMs: 5_000 });
  } catch {
    return false;
  }
}

export async function appendPostgresNovelChapters(novelIdValue: number, files: File[]): Promise<number> {
  const novelId = positiveId(novelIdValue, "小说");
  const novel = await getPostgresAdminNovel(database("web"), novelId);
  if (!novel || novel.storage_mode !== "chapters") throw new Error("这不是章节小说");
  const prepared = await prepareChapterFiles(files);
  const directory = libraryPath(novel.relative_path);
  const stored = await storeChapterFiles(directory, novel.relative_path, prepared);
  let inserted: InsertedChapter[] = [];
  try {
    inserted = await withTransaction(async (tx) => {
      const locked = await tx.query({
        text: "SELECT id FROM novels WHERE id = $1 AND storage_mode = 'chapters' FOR UPDATE",
        values: [novelId],
      });
      if (!locked.rowCount) throw new Error("这不是章节小说");
      const maximum = await tx.query<{ value: string | number }>({
        text: "SELECT COALESCE(MAX(sort_order), -1) AS value FROM novel_chapters WHERE novel_id = $1",
        values: [novelId],
      });
      const start = nonnegativeInteger(Number(maximum.rows[0]?.value ?? -1) + 1, "章节排序");
      const rows = await tx.query<{ id: string | number; relative_path: string }>({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($2::jsonb) AS value(
              title text, relative_path text, sort_order integer, content_hash text,
              size_bytes bigint, mtime_ms bigint, word_count integer)
          ) INSERT INTO novel_chapters (
            novel_id,title,relative_path,sort_order,content_hash,size_bytes,mtime_ms,word_count)
          SELECT $1,title,relative_path,sort_order,content_hash,size_bytes,mtime_ms,word_count FROM input
          RETURNING id, relative_path`,
        values: [novelId, JSON.stringify(stored.map((chapter, index) => ({ title: chapter.title,
          relative_path: chapter.relativePath, sort_order: start + index, content_hash: chapter.contentHash,
          size_bytes: chapter.sizeBytes, mtime_ms: chapter.mtimeMs, word_count: chapter.wordCount })))],
      });
      const ids = new Map(rows.rows.map((row) => [row.relative_path, positiveId(row.id, "章节")]));
      const output = stored.map((chapter) => {
        const id = ids.get(chapter.relativePath);
        if (!id) throw new Error("章节写入不完整");
        return { ...chapter, id };
      });
      await recomputeChapterNovel(tx, novelId);
      return output;
    }, { isolation: "serializable", lockTimeoutMs: 5_000 });
    for (const chapter of inserted) await publishInsertedChapter(chapter, novelId);
    return inserted.length;
  } catch (error) {
    const catalogRemoved = !inserted.length || await rollbackInsertedChapters(novelId, inserted.map((chapter) => chapter.id));
    if (catalogRemoved) {
      await Promise.all(stored.map((chapter) => fs.rm(libraryPath(chapter.relativePath), { force: true }).catch(() => undefined)));
    }
    throw error;
  }
}

export async function updatePostgresNovelFile(input: {
  novelId: number;
  title: string;
  content: string;
}): Promise<void> {
  const novelId = positiveId(input.novelId, "小说");
  const novel = await getPostgresAdminNovel(database("web"), novelId);
  if (!novel) throw new Error("小说不存在");
  if (novel.storage_mode !== "single") throw new Error("分章小说请在章节管理中编辑正文");
  const title = normalizeTitle(input.title);
  const buffer = Buffer.from(input.content, "utf8");
  if (!buffer.length) throw new Error("正文不能为空");
  const target = libraryPath(novel.relative_path);
  const previousBuffer = await fs.readFile(target);
  const hash = contentHash(buffer);
  const [forms, previousForms] = await Promise.all([
    normalizeChineseSearchForms(title, "title"),
    normalizeChineseSearchForms(novel.title, "title"),
    replaceFileAtomically(target, buffer),
  ]);
  const stat = await fs.stat(target);
  const executor = database("web");
  const changed = await executor.query({
    text: `UPDATE novels SET title=$2,title_search_original=$3,title_search_hans=$4,
      normalization_version=$5,content_hash=$6,size_bytes=$7,mtime_ms=$8,word_count=$9,
      updated_at=clock_timestamp() WHERE id=$1 AND storage_mode='single'
      AND content_hash IS NOT DISTINCT FROM $10`,
    values: [novelId, title, forms.original, forms.hans, forms.version, hash, stat.size,
      Math.round(stat.mtimeMs), contentWordCount(buffer), novel.content_hash],
  });
  if (!changed.rowCount) {
    await replaceFileAtomically(target, previousBuffer);
    throw new Error("小说已被其他操作修改，请刷新后重试");
  }
  try {
    await publishPostgresContent({ novelId, chapterId: null, sourceContentVersion: hash,
      expectedPublishedVersion: novel.published_content_version, text: input.content });
  } catch (error) {
    const current = await executor.query<{ published_content_version: string | null }>({
      text: "SELECT published_content_version FROM novels WHERE id = $1 AND content_hash = $2",
      values: [novelId, hash],
    }).catch(() => null);
    if (current?.rows[0]?.published_content_version === hash) return;
    await replaceFileAtomically(target, previousBuffer);
    const restoredStat = await fs.stat(target);
    const restored = await executor.query({
      text: `UPDATE novels SET title=$2,title_search_original=$3,title_search_hans=$4,
        normalization_version=$5,content_hash=$6,size_bytes=$7,mtime_ms=$8,word_count=$9,
        updated_at=clock_timestamp() WHERE id=$1 AND content_hash=$10
        AND published_content_version IS NOT DISTINCT FROM $11`,
      values: [novelId, novel.title, previousForms.original, previousForms.hans, previousForms.version,
        novel.content_hash, restoredStat.size, Math.round(restoredStat.mtimeMs), contentWordCount(previousBuffer),
        hash, novel.published_content_version],
    }).catch(() => null);
    if (!restored?.rowCount) {
      const owner = await executor.query<{ content_hash: string | null }>({
        text: "SELECT content_hash FROM novels WHERE id = $1",
        values: [novelId],
      }).catch(() => null);
      if (owner?.rows[0]?.content_hash === hash) await replaceFileAtomically(target, buffer);
    }
    throw error;
  }
}

export async function deletePostgresNovelIds(idValues: readonly number[]): Promise<DeleteNovelSummary> {
  const ids = [...new Set(idValues.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500);
  if (!ids.length) return { deleted: 0, fileDeleteFailures: [] };
  const rows = await withTransaction(async (tx) => {
    const selected = await tx.query<{ id: string | number; relative_path: string }>({
      text: "SELECT id, relative_path FROM novels WHERE id = ANY($1::integer[]) FOR UPDATE",
      values: [ids],
    });
    if (selected.rowCount) await tx.query({ text: "DELETE FROM novels WHERE id = ANY($1::integer[])", values: [ids] });
    return selected.rows;
  }, { isolation: "serializable", lockTimeoutMs: 5_000 });
  const failures: string[] = [];
  for (const row of rows) {
    try {
      await fs.rm(libraryPath(row.relative_path), { recursive: true, force: true });
    } catch {
      failures.push(row.relative_path);
    }
  }
  return { deleted: rows.length, fileDeleteFailures: failures };
}

export async function deletePostgresNovelChapterIds(
  novelIdValue: number,
  chapterIdValues: readonly number[],
): Promise<number> {
  const novelId = positiveId(novelIdValue, "小说");
  const chapterIds = [...new Set(chapterIdValues.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!chapterIds.length) return 0;
  const removed = await withTransaction(async (tx) => {
    const novel = await tx.query({ text: "SELECT id FROM novels WHERE id = $1 FOR UPDATE", values: [novelId] });
    if (!novel.rowCount) throw new Error("小说不存在");
    const selected = await tx.query<{ id: string | number; relative_path: string }>({
      text: `SELECT id, relative_path FROM novel_chapters
        WHERE novel_id=$1 AND id=ANY($2::integer[]) FOR UPDATE`,
      values: [novelId, chapterIds],
    });
    if (!selected.rowCount) return [];
    const count = await tx.query<{ count: string | number }>({
      text: "SELECT COUNT(*)::bigint AS count FROM novel_chapters WHERE novel_id=$1",
      values: [novelId],
    });
    if (selected.rows.length >= nonnegativeInteger(count.rows[0]?.count ?? 0, "章节数")) {
      throw new Error("章节小说至少保留一个章节；如需清空，请删除整本小说");
    }
    await tx.query({
      text: "DELETE FROM novel_chapters WHERE novel_id=$1 AND id=ANY($2::integer[])",
      values: [novelId, selected.rows.map((row) => positiveId(row.id, "章节"))],
    });
    await recomputeChapterNovel(tx, novelId);
    return selected.rows;
  }, { isolation: "serializable", lockTimeoutMs: 5_000 });
  await Promise.all(removed.map((row) => fs.rm(libraryPath(row.relative_path), { force: true }).catch(() => undefined)));
  return removed.length;
}

export type { NovelChapterUpdate };
