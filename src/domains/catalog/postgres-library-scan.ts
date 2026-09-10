import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { normalizeChineseSearchForms } from "@/domains/reading/content-text";
import { publishPostgresContent } from "@/domains/reading/postgres-content";
import { getLibraryDir } from "@/lib/config";
import { isNovelTextFile, parseNovelTitle } from "@/lib/filename";
import { decodeNovelBuffer } from "@/lib/text";
import { chapterAggregateHash } from "./postgres-admin-novels";

type ExistingFile = Readonly<{
  id: number;
  novelId: number;
  relativePath: string;
  contentHash: string | null;
  publishedContentVersion: string | null;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  storageMode: "single" | "chapters";
}>;

type ScannedFile = Readonly<{
  title: string;
  fileName: string;
  relativePath: string;
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  contentChanged: boolean;
}>;

type ScannedNovel = Readonly<{
  title: string;
  fileName: string;
  relativePath: string;
  sourceId: number;
  storageMode: "single" | "chapters";
  contentHash: string;
  sizeBytes: number;
  mtimeMs: number;
  wordCount: number;
  chapters: readonly ScannedFile[];
}>;

export type PostgresLibraryScanResult = Readonly<{
  books: number;
  files: number;
  insertedOrUpdated: number;
  publishedDocuments: number;
  skipped: number;
  elapsedMs: number;
  records: readonly string[];
}>;

type ExistingNovelRow = QueryResultRow & {
  id: string | number;
  relative_path: string;
  content_hash: string | null;
  published_content_version: string | null;
  size_bytes: string | number;
  mtime_ms: string | number;
  word_count: string | number;
  storage_mode: string;
};

type ExistingChapterRow = QueryResultRow & ExistingNovelRow & { novel_id: string | number };
type PublishedOwner = Readonly<{ novelId: number; chapterId: number | null; file: ScannedFile; expectedVersion: string | null }>;

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

function safeInteger(value: string | number, label: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+|\/+$/gu, "");
}

function sourceSlug(relativePath: string): string {
  if (!relativePath) return "default";
  const readable = relativePath.normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 54);
  return `${readable || "source"}-${createHash("sha256").update(relativePath).digest("hex").slice(0, 8)}`;
}

async function directTextFiles(directory: string, relativeDirectory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isNovelTextFile(entry.name))
    .map((entry) => normalizeRelative(path.posix.join(relativeDirectory, entry.name)))
    .sort(collator.compare);
}

async function existingFiles(executor: SqlExecutor): Promise<{
  novels: Map<string, ExistingFile>;
  chapters: Map<string, ExistingFile>;
}> {
  const [novelsResult, chaptersResult] = await Promise.all([
    executor.query<ExistingNovelRow>({
      text: `SELECT id, relative_path, content_hash, published_content_version,
          size_bytes, mtime_ms, word_count, storage_mode FROM novels`,
    }),
    executor.query<ExistingChapterRow>({
      text: `SELECT id, novel_id, relative_path, content_hash, published_content_version,
          size_bytes, mtime_ms, word_count, 'chapters'::text AS storage_mode FROM novel_chapters`,
    }),
  ]);
  const mapRow = (row: ExistingNovelRow, novelId: number): ExistingFile => {
    if (row.storage_mode !== "single" && row.storage_mode !== "chapters") throw new Error("Invalid PostgreSQL novel storage mode");
    return {
      id: safeInteger(row.id, "catalog id", 1),
      novelId,
      relativePath: normalizeRelative(row.relative_path),
      contentHash: row.content_hash,
      publishedContentVersion: row.published_content_version,
      sizeBytes: safeInteger(row.size_bytes, "catalog size"),
      mtimeMs: safeInteger(row.mtime_ms, "catalog mtime"),
      wordCount: safeInteger(row.word_count, "catalog word count"),
      storageMode: row.storage_mode,
    };
  };
  const novels = new Map<string, ExistingFile>();
  for (const row of novelsResult.rows) {
    const id = safeInteger(row.id, "novel id", 1);
    const item = mapRow(row, id);
    novels.set(item.relativePath, item);
  }
  const chapters = new Map<string, ExistingFile>();
  for (const row of chaptersResult.rows) {
    const item = mapRow(row, safeInteger(row.novel_id, "chapter novel id", 1));
    chapters.set(item.relativePath, item);
  }
  return { novels, chapters };
}

async function scanFile(
  libraryRoot: string,
  relativePath: string,
  existing: ExistingFile | undefined,
  verifyHashes: boolean,
): Promise<ScannedFile> {
  const absolutePath = path.resolve(libraryRoot, relativePath);
  if (!absolutePath.startsWith(`${libraryRoot}${path.sep}`)) throw new Error("小说文件路径越界");
  const stat = await fs.stat(absolutePath);
  const mtimeMs = Math.round(stat.mtimeMs);
  const fileName = path.posix.basename(relativePath);
  const title = parseNovelTitle(fileName);
  if (!title) throw new Error("文件名解析后的标题为空");
  if (!verifyHashes && existing?.contentHash && existing.sizeBytes === stat.size && existing.mtimeMs === mtimeMs) {
    return {
      title,
      fileName,
      relativePath,
      contentHash: existing.contentHash,
      sizeBytes: existing.sizeBytes,
      mtimeMs,
      wordCount: existing.wordCount,
      contentChanged: false,
    };
  }
  const buffer = await fs.readFile(absolutePath);
  if (!buffer.length) throw new Error("文件为空");
  const contentHash = createHash("sha256").update(buffer).digest("hex");
  return {
    title,
    fileName,
    relativePath,
    contentHash,
    sizeBytes: stat.size,
    mtimeMs,
    wordCount: Array.from(decodeNovelBuffer(buffer).replace(/\s+/gu, "")).length,
    contentChanged: existing?.contentHash !== contentHash,
  };
}

async function ensureSource(executor: SqlExecutor, relativePath: string, name: string): Promise<number> {
  const result = await executor.query<{ id: string | number }>({
    text: `INSERT INTO novel_sources (slug, name, relative_path, sort_order)
      VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order) + 10 FROM novel_sources), 0))
      ON CONFLICT (relative_path) DO UPDATE SET updated_at = novel_sources.updated_at
      RETURNING id`,
    values: [sourceSlug(relativePath), name, relativePath],
  });
  return safeInteger(result.rows[0].id, "novel source id", 1);
}

async function discoverNovels(
  executor: SqlExecutor,
  libraryRoot: string,
  known: Awaited<ReturnType<typeof existingFiles>>,
  verifyHashes: boolean,
  records: string[],
): Promise<{ novels: ScannedNovel[]; files: number; skipped: number }> {
  const novels: ScannedNovel[] = [];
  let files = 0;
  let skipped = 0;
  const defaultSourceId = await ensureSource(executor, "", "默认来源");

  const addSingleFiles = async (directory: string, relativeDirectory: string, sourceId: number) => {
    for (const relativePath of await directTextFiles(directory, relativeDirectory)) {
      files += 1;
      try {
        const file = await scanFile(libraryRoot, relativePath, known.novels.get(relativePath), verifyHashes);
        novels.push({ ...file, sourceId, storageMode: "single", chapters: [] });
      } catch (error) {
        skipped += 1;
        records.push(`${relativePath}: ${error instanceof Error ? error.message : "读取失败"}`);
      }
    }
  };

  await addSingleFiles(libraryRoot, "", defaultSourceId);
  const sourceEntries = (await fs.readdir(libraryRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => collator.compare(left.name, right.name));
  for (const sourceEntry of sourceEntries) {
    const relativeSource = normalizeRelative(sourceEntry.name);
    const sourceDirectory = path.join(libraryRoot, sourceEntry.name);
    const sourceId = relativeSource.toLocaleLowerCase("en-US") === "default"
      ? defaultSourceId
      : await ensureSource(executor, relativeSource, sourceEntry.name);
    await addSingleFiles(sourceDirectory, relativeSource, sourceId);
    const bookEntries = (await fs.readdir(sourceDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((left, right) => collator.compare(left.name, right.name));
    for (const bookEntry of bookEntries) {
      const relativeDirectory = normalizeRelative(path.posix.join(relativeSource, bookEntry.name));
      const chapterPaths = await directTextFiles(path.join(sourceDirectory, bookEntry.name), relativeDirectory);
      files += chapterPaths.length;
      const chapters: ScannedFile[] = [];
      for (const chapterPath of chapterPaths) {
        try {
          chapters.push(await scanFile(libraryRoot, chapterPath, known.chapters.get(chapterPath), verifyHashes));
        } catch (error) {
          skipped += 1;
          records.push(`${chapterPath}: ${error instanceof Error ? error.message : "读取失败"}`);
        }
      }
      if (!chapters.length) continue;
      novels.push({
        title: parseNovelTitle(`${bookEntry.name}.txt`) || bookEntry.name,
        fileName: bookEntry.name,
        relativePath: relativeDirectory,
        sourceId,
        storageMode: "chapters",
        contentHash: chapterAggregateHash(chapters.map((chapter) => ({ relativePath: chapter.relativePath, contentHash: chapter.contentHash }))),
        sizeBytes: chapters.reduce((sum, chapter) => sum + chapter.sizeBytes, 0),
        mtimeMs: Math.max(...chapters.map((chapter) => chapter.mtimeMs)),
        wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
        chapters,
      });
    }
  }
  return { novels, files, skipped };
}

async function upsertNovel(
  novel: ScannedNovel,
  known: Awaited<ReturnType<typeof existingFiles>>,
): Promise<{ changed: boolean; publish: PublishedOwner[] }> {
  const existingNovel = known.novels.get(novel.relativePath);
  const titleForms = await normalizeChineseSearchForms(novel.title, "title");
  return withTransaction(async (tx) => {
    const result = await tx.query<{ id: string | number; published_content_version: string | null }>({
      text: `INSERT INTO novels (
          title, title_search_original, title_search_hans, normalization_version,
          file_name, relative_path, source_id, storage_mode, chapter_count,
          content_hash, size_bytes, mtime_ms, word_count, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,clock_timestamp())
        ON CONFLICT (relative_path) DO UPDATE SET
          title=EXCLUDED.title, title_search_original=EXCLUDED.title_search_original,
          title_search_hans=EXCLUDED.title_search_hans, normalization_version=EXCLUDED.normalization_version,
          file_name=EXCLUDED.file_name, source_id=EXCLUDED.source_id, storage_mode=EXCLUDED.storage_mode,
          chapter_count=EXCLUDED.chapter_count, content_hash=EXCLUDED.content_hash,
          size_bytes=EXCLUDED.size_bytes, mtime_ms=EXCLUDED.mtime_ms,
          word_count=EXCLUDED.word_count, updated_at=clock_timestamp()
        RETURNING id, published_content_version`,
      values: [novel.title, titleForms.original, titleForms.hans, titleForms.version, novel.fileName,
        novel.relativePath, novel.sourceId, novel.storageMode, novel.chapters.length,
        novel.contentHash, novel.sizeBytes, novel.mtimeMs, novel.wordCount],
    });
    const novelId = safeInteger(result.rows[0].id, "upserted novel id", 1);
    const publish: PublishedOwner[] = [];
    if (novel.storageMode === "single") {
      await tx.query({ text: "DELETE FROM novel_chapters WHERE novel_id = $1", values: [novelId] });
      const file: ScannedFile = { title: novel.title, fileName: novel.fileName, relativePath: novel.relativePath,
        contentHash: novel.contentHash, sizeBytes: novel.sizeBytes, mtimeMs: novel.mtimeMs,
        wordCount: novel.wordCount, contentChanged: existingNovel?.contentHash !== novel.contentHash };
      if (result.rows[0].published_content_version !== novel.contentHash) {
        publish.push({ novelId, chapterId: null, file, expectedVersion: result.rows[0].published_content_version });
      }
    } else {
      await tx.query({ text: "UPDATE novel_chapters SET sort_order = sort_order + 1000000 WHERE novel_id = $1", values: [novelId] });
      const chapterResult = await tx.query<{ id: string | number; relative_path: string; content_hash: string; published_content_version: string | null }>({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($2::jsonb) AS value(
              title text, relative_path text, sort_order integer, content_hash text,
              size_bytes bigint, mtime_ms bigint, word_count integer)
          ) INSERT INTO novel_chapters (
            novel_id,title,relative_path,sort_order,content_hash,size_bytes,mtime_ms,word_count,updated_at)
          SELECT $1,title,relative_path,sort_order,content_hash,size_bytes,mtime_ms,word_count,clock_timestamp() FROM input
          ON CONFLICT (relative_path) DO UPDATE SET novel_id=EXCLUDED.novel_id,
            title=EXCLUDED.title,sort_order=EXCLUDED.sort_order,content_hash=EXCLUDED.content_hash,
            size_bytes=EXCLUDED.size_bytes,mtime_ms=EXCLUDED.mtime_ms,word_count=EXCLUDED.word_count,
            updated_at=clock_timestamp()
          RETURNING id, relative_path, content_hash, published_content_version`,
        values: [novelId, JSON.stringify(novel.chapters.map((chapter, index) => ({ title: chapter.title,
          relative_path: chapter.relativePath, sort_order: index, content_hash: chapter.contentHash,
          size_bytes: chapter.sizeBytes, mtime_ms: chapter.mtimeMs, word_count: chapter.wordCount })))],
      });
      await tx.query({
        text: "DELETE FROM novel_chapters WHERE novel_id = $1 AND relative_path <> ALL($2::text[])",
        values: [novelId, novel.chapters.map((chapter) => chapter.relativePath)],
      });
      const files = new Map(novel.chapters.map((chapter) => [chapter.relativePath, chapter]));
      for (const row of chapterResult.rows) {
        const file = files.get(normalizeRelative(row.relative_path));
        if (file && row.published_content_version !== row.content_hash) {
          publish.push({ novelId, chapterId: safeInteger(row.id, "upserted chapter id", 1), file,
            expectedVersion: row.published_content_version });
        }
      }
    }
    const changed = !existingNovel || existingNovel.contentHash !== novel.contentHash
      || existingNovel.storageMode !== novel.storageMode || existingNovel.sizeBytes !== novel.sizeBytes
      || existingNovel.mtimeMs !== novel.mtimeMs;
    return { changed, publish };
  }, { role: "jobs", isolation: "serializable", lockTimeoutMs: 5_000 });
}

async function publishOwner(libraryRoot: string, owner: PublishedOwner): Promise<void> {
  const buffer = await fs.readFile(path.resolve(libraryRoot, owner.file.relativePath));
  const currentHash = createHash("sha256").update(buffer).digest("hex");
  if (currentHash !== owner.file.contentHash) throw new Error(`文件在扫描期间发生变化：${owner.file.relativePath}`);
  await publishPostgresContent({ novelId: owner.novelId, chapterId: owner.chapterId,
    sourceContentVersion: owner.file.contentHash, expectedPublishedVersion: owner.expectedVersion,
    text: decodeNovelBuffer(buffer) });
}

export async function scanPostgresNovelLibrary(options: { verifyHashes?: boolean } = {}): Promise<PostgresLibraryScanResult> {
  const startedAt = Date.now();
  const libraryRoot = path.resolve(getLibraryDir());
  await fs.mkdir(libraryRoot, { recursive: true });
  const executor = database("jobs");
  const known = await existingFiles(executor);
  const records: string[] = [];
  const discovery = await discoverNovels(executor, libraryRoot, known, options.verifyHashes === true, records);
  let insertedOrUpdated = 0;
  let publishedDocuments = 0;
  let duplicateCount = 0;
  const duplicateKeys = new Map<string, string>();
  for (const novel of discovery.novels) {
    if (novel.storageMode === "single") {
      const key = `${novel.sourceId}\0${novel.title}\0${novel.contentHash}`;
      const duplicate = duplicateKeys.get(key);
      if (duplicate) {
        records.push(`${novel.relativePath}: 与 ${duplicate} 内容相同，已跳过`);
        duplicateCount += 1;
        continue;
      }
      duplicateKeys.set(key, novel.relativePath);
    }
    const result = await upsertNovel(novel, known);
    if (result.changed) insertedOrUpdated += 1;
    for (const owner of result.publish) {
      await publishOwner(libraryRoot, owner);
      publishedDocuments += 1;
    }
  }
  return { books: discovery.novels.length, files: discovery.files, insertedOrUpdated, publishedDocuments,
    skipped: discovery.skipped + duplicateCount, elapsedMs: Date.now() - startedAt, records };
}
