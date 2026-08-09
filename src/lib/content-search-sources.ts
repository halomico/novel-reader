import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { getContentSearchDatabasePath, getContentSearchIndexDirectory } from "./config";
import {
  getContentSearchDatabaseDiskUsage,
  getContentSearchDatabasePathForSource,
  getContentSearchDb,
  getExistingContentSearchDb,
  closeContentSearchDb,
  closeLegacyContentSearchDb,
  initializeContentSearchDb,
} from "./content-search-db";
import {
  buildContentSearchIndex,
  CONTENT_SEARCH_INDEX_VERSION,
  getContentSearchIndexSummary,
  type ContentSearchIndexBuildOptions,
  type ContentSearchIndexProgress,
  type ContentSearchIndexResult,
  type ContentSearchIndexSummary,
} from "./content-search-index";
import { getDb } from "./db";
import { listNovelSources } from "./novel-library";
import { getNovelSourceSearchMode } from "./novel-search-policy";
import type { NovelSourceSearchMode } from "./site-settings";

export type ContentSearchSourceState = "disabled" | "missing" | "pending" | "ready" | "failed";

export type ContentSearchSourceSummary = ContentSearchIndexSummary & {
  sourceId: number;
  slug: string;
  name: string;
  mode: NovelSourceSearchMode;
  state: ContentSearchSourceState;
};

function getSourceTotals(mainDb: DatabaseSync, sourceId: number): { totalBooks: number; sourceBytes: number } {
  return mainDb.prepare(
    "SELECT COUNT(*) AS totalBooks, COALESCE(SUM(size_bytes), 0) AS sourceBytes FROM novels WHERE source_id = ?",
  ).get(sourceId) as { totalBooks: number; sourceBytes: number };
}

function emptySummary(totalBooks: number, sourceBytes: number, databaseBytes: number): ContentSearchIndexSummary {
  return {
    totalBooks,
    indexedBooks: 0,
    pendingBooks: totalBooks,
    staleBooks: 0,
    failedBooks: 0,
    sourceBytes,
    databaseBytes,
    databaseRatio: sourceBytes > 0 ? databaseBytes / sourceBytes : 0,
    indexVersion: CONTENT_SEARCH_INDEX_VERSION,
    lastIndexedAt: null,
  };
}

export function listContentSearchSourceSummaries(mainDb: DatabaseSync = getDb()): ContentSearchSourceSummary[] {
  return listNovelSources({ includeEmpty: true }).map((source) => {
    const mode = getNovelSourceSearchMode(source.slug);
    const totals = getSourceTotals(mainDb, source.id);
    const databaseBytes = getContentSearchDatabaseDiskUsage(source.id);
    const searchDb = mode === "full" ? getExistingContentSearchDb(source.id) : null;
    const summary = searchDb
      ? getContentSearchIndexSummary(mainDb, searchDb, { sourceId: source.id })
      : emptySummary(totals.totalBooks, totals.sourceBytes, databaseBytes);
    const state: ContentSearchSourceState = mode === "book"
      ? "disabled"
      : summary.failedBooks > 0
        ? "failed"
        : summary.totalBooks === 0 || (summary.pendingBooks === 0 && summary.indexedBooks === summary.totalBooks)
          ? "ready"
          : summary.indexedBooks > 0
            ? "pending"
            : "missing";
    return {
      ...summary,
      sourceId: source.id,
      slug: source.slug,
      name: source.name,
      mode,
      state,
    };
  });
}

export function getContentSearchCombinedSummary(mainDb: DatabaseSync = getDb()): ContentSearchIndexSummary {
  const summaries = listContentSearchSourceSummaries(mainDb).filter((source) => source.mode === "full");
  const combined = summaries.reduce(
    (total, source) => ({
      totalBooks: total.totalBooks + source.totalBooks,
      indexedBooks: total.indexedBooks + source.indexedBooks,
      pendingBooks: total.pendingBooks + source.pendingBooks,
      staleBooks: total.staleBooks + source.staleBooks,
      failedBooks: total.failedBooks + source.failedBooks,
      sourceBytes: total.sourceBytes + source.sourceBytes,
      databaseBytes: total.databaseBytes + source.databaseBytes,
      lastIndexedAt: !total.lastIndexedAt || (source.lastIndexedAt && source.lastIndexedAt > total.lastIndexedAt)
        ? source.lastIndexedAt
        : total.lastIndexedAt,
    }),
    {
      totalBooks: 0,
      indexedBooks: 0,
      pendingBooks: 0,
      staleBooks: 0,
      failedBooks: 0,
      sourceBytes: 0,
      databaseBytes: 0,
      lastIndexedAt: null as string | null,
    },
  );
  return {
    ...combined,
    databaseRatio: combined.sourceBytes > 0 ? combined.databaseBytes / combined.sourceBytes : 0,
    indexVersion: CONTENT_SEARCH_INDEX_VERSION,
  };
}

export function getLegacyContentSearchDiskUsage(): number {
  const databasePath = getContentSearchDatabasePath();
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`].reduce((total, filePath) => {
    try {
      return total + fs.statSync(filePath).size;
    } catch {
      return total;
    }
  }, 0);
}

export function deleteLegacyContentSearchDatabase() {
  const legacyGlobal = globalThis as typeof globalThis & { novelReaderContentSearchDb?: DatabaseSync };
  legacyGlobal.novelReaderContentSearchDb?.close();
  delete legacyGlobal.novelReaderContentSearchDb;
  closeLegacyContentSearchDb();
  const databasePath = getContentSearchDatabasePath();
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    fs.rmSync(filePath, { force: true });
  }
}

function removeBuildFiles(databasePath: string) {
  for (const filePath of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    fs.rmSync(filePath, { force: true });
  }
}

export async function buildContentSearchSourceIndex(
  mainDb: DatabaseSync,
  sourceId: number,
  onProgress?: (progress: ContentSearchIndexProgress) => void,
  options: Omit<ContentSearchIndexBuildOptions, "sourceId" | "novelIds"> = {},
): Promise<ContentSearchIndexResult> {
  const targetPath = getContentSearchDatabasePathForSource(sourceId);
  const useShadowBuild = options.force === true || !fs.existsSync(targetPath);
  if (!useShadowBuild) {
    return buildContentSearchIndex(mainDb, getContentSearchDb(sourceId), onProgress, { ...options, sourceId });
  }

  fs.mkdirSync(getContentSearchIndexDirectory(), { recursive: true });
  const buildPath = `${targetPath}.building-${process.pid}-${Date.now()}`;
  const backupPath = `${targetPath}.previous`;
  const buildDb = new DatabaseSync(buildPath);
  initializeContentSearchDb(buildDb);
  let buildClosed = false;
  try {
    const result = await buildContentSearchIndex(mainDb, buildDb, onProgress, {
      ...options,
      force: true,
      sourceId,
    });
    buildDb.close();
    buildClosed = true;
    closeContentSearchDb(sourceId);
    removeBuildFiles(backupPath);
    if (fs.existsSync(targetPath)) fs.renameSync(targetPath, backupPath);
    try {
      fs.renameSync(buildPath, targetPath);
    } catch (error) {
      if (fs.existsSync(backupPath)) fs.renameSync(backupPath, targetPath);
      throw error;
    }
    removeBuildFiles(backupPath);
    fs.rmSync(`${targetPath}-wal`, { force: true });
    fs.rmSync(`${targetPath}-shm`, { force: true });
    return result;
  } catch (error) {
    if (!buildClosed) buildDb.close();
    removeBuildFiles(buildPath);
    throw error;
  }
}
