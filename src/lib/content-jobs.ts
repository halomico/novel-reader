import crypto from "node:crypto";
import {
  getCachedContentSearchResults,
  getContentSearchCacheVersion,
  hasCachedContentSearchResults as hasCachedSearchResults,
  invalidateContentSearchResultCache,
  setCachedContentSearchResults,
} from "./content-search-cache";
import { ContentSearchIndexCancelledError } from "./content-search-index";
import { buildContentSearchSourceIndex } from "./content-search-sources";
import { getDb } from "./db";
import { getNovelSourceById, listNovelSources } from "./novel-library";
import { isNovelSourceFullTextSearchEnabled } from "./novel-search-policy";
import { ContentSearchCancelledError, searchNovelContent, type SearchResult } from "./search";
import type { ParsedSearchQuery } from "./search-query";

type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";
type JobKind = "search" | "index";

export type ContentJobSnapshot = {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
  totalBooks: number;
  scannedBooks: number;
  resultCount: number;
  indexedBooks: number;
  reusedBooks: number;
  failedBooks: number;
  sourceId: number | null;
  sourceName?: string;
  results?: SearchResult[];
  error?: string;
  cancelRequested?: boolean;
};

type ContentJob = ContentJobSnapshot;

type ContentSearchJobOptions = {
  candidateNovelIds?: number[];
  cacheScope?: string;
};

type JobGlobal = typeof globalThis & {
  novelReaderContentJobs?: Map<string, ContentJob>;
  novelReaderContentJobTimers?: Map<string, ReturnType<typeof setTimeout>>;
};

const JOB_TTL_MS = 30 * 60 * 1000;
const JOB_EXPIRY_GRACE_MS = 60 * 1000;
const JOB_MAX_ENTRIES = 64;

function getJobs(): Map<string, ContentJob> {
  const globalForJobs = globalThis as JobGlobal;
  if (!globalForJobs.novelReaderContentJobs) {
    globalForJobs.novelReaderContentJobs = new Map();
  }
  return globalForJobs.novelReaderContentJobs;
}

function getJobTimers(): Map<string, ReturnType<typeof setTimeout>> {
  const globalForJobs = globalThis as JobGlobal;
  if (!globalForJobs.novelReaderContentJobTimers) {
    globalForJobs.novelReaderContentJobTimers = new Map();
  }
  return globalForJobs.novelReaderContentJobTimers;
}

function deleteJob(id: string) {
  getJobs().delete(id);
  const timer = getJobTimers().get(id);
  if (timer) clearTimeout(timer);
  getJobTimers().delete(id);
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of getJobs()) {
    if (now - job.createdAt > JOB_TTL_MS) {
      if (job.status === "queued" || job.status === "running") {
        updateJob(job, { status: "cancelled", cancelRequested: true, message: "任务运行超过 30 分钟，已自动取消" });
      }
      deleteJob(id);
    }
  }

  const jobs = getJobs();
  if (jobs.size <= JOB_MAX_ENTRIES) {
    return;
  }
  const completedJobs = Array.from(jobs.values())
    .filter((job) => job.status !== "queued" && job.status !== "running")
    .sort((left, right) => left.createdAt - right.createdAt);
  for (const job of completedJobs) {
    if (jobs.size <= JOB_MAX_ENTRIES) break;
    deleteJob(job.id);
  }
}

function scheduleJobExpiry(id: string) {
  const timeout = setTimeout(() => {
    getJobTimers().delete(id);
    const job = getJobs().get(id);
    if (!job) return;
    if (job.status === "queued" || job.status === "running") {
      updateJob(job, { status: "cancelled", cancelRequested: true, message: "任务运行超过 30 分钟，已自动取消" });
      const removal = setTimeout(() => deleteJob(id), JOB_EXPIRY_GRACE_MS);
      removal.unref?.();
      getJobTimers().set(id, removal);
      return;
    }
    deleteJob(id);
  }, JOB_TTL_MS);
  timeout.unref?.();
  getJobTimers().set(id, timeout);
}

function createJob(kind: JobKind, message: string, sourceId: number | null = null, sourceName?: string): ContentJob {
  cleanupJobs();
  const jobs = getJobs();
  if (jobs.size >= JOB_MAX_ENTRIES) {
    const oldestCompletedJob = Array.from(jobs.values())
      .filter((job) => job.status !== "queued" && job.status !== "running")
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (oldestCompletedJob) {
      deleteJob(oldestCompletedJob.id);
    }
  }
  const now = Date.now();
  const job: ContentJob = {
    id: crypto.randomUUID(),
    kind,
    status: "queued",
    progress: 0,
    message,
    createdAt: now,
    updatedAt: now,
    totalBooks: 0,
    scannedBooks: 0,
    resultCount: 0,
    indexedBooks: 0,
    reusedBooks: 0,
    failedBooks: 0,
    sourceId,
    sourceName,
  };
  jobs.set(job.id, job);
  scheduleJobExpiry(job.id);
  return job;
}

function updateJob(job: ContentJob, patch: Partial<ContentJob>) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function progress(scannedBooks: number, totalBooks: number): number {
  if (totalBooks <= 0) {
    return 0;
  }
  return Math.min(99, Math.round((scannedBooks / totalBooks) * 100));
}

function scheduleJob(runner: () => Promise<void>) {
  setTimeout(() => {
    runner().catch(() => {
      // The runner updates its own job state; this catch prevents unhandled rejections.
    });
  }, 0);
}

export function getContentJob(id: string, includeResults = false): ContentJobSnapshot | null {
  cleanupJobs();
  const job = getJobs().get(id);
  if (!job) return null;
  const snapshot = { ...job, results: undefined };
  return includeResults && job.results ? { ...snapshot, results: [...job.results] } : snapshot;
}

export function countActiveContentJobs(kind?: JobKind): number {
  cleanupJobs();
  return Array.from(getJobs().values()).filter(
    (job) => (kind === undefined || job.kind === kind) && (job.status === "queued" || job.status === "running"),
  ).length;
}

export function hasCachedContentSearchResults(query: ParsedSearchQuery, cacheScope = ""): boolean {
  return hasCachedSearchResults(query, cacheScope);
}

export function cancelContentJob(id: string): ContentJobSnapshot | null {
  cleanupJobs();
  const job = getJobs().get(id);
  if (!job) {
    return null;
  }

  if (job.status === "queued" || job.status === "running") {
    updateJob(job, {
      cancelRequested: true,
      message: job.kind === "index" ? "正在取消索引任务" : "正在取消任务",
    });
  }

  return getContentJob(id);
}

export function cancelContentJobs(kind?: JobKind) {
  for (const job of getJobs().values()) {
    if ((kind === undefined || job.kind === kind) && (job.status === "queued" || job.status === "running")) {
      updateJob(job, {
        cancelRequested: true,
        message: job.kind === "index" ? "正在取消索引任务" : "正在取消任务",
      });
    }
  }
}

export function startContentSearchJob(query: ParsedSearchQuery, options: ContentSearchJobOptions = {}): ContentJobSnapshot {
  const job = createJob("search", "正在准备全文搜索");
  const cachedResults = getCachedContentSearchResults(query, options.cacheScope);
  if (cachedResults) {
    updateJob(job, {
      status: "done",
      progress: 100,
      resultCount: cachedResults.length,
      results: cachedResults,
      message: cachedResults.length ? `找到 ${cachedResults.length} 条匹配内容（缓存）` : "未找到匹配正文（缓存）",
    });
    return getContentJob(job.id) || job;
  }
  const cacheVersion = getContentSearchCacheVersion();

  scheduleJob(async () => {
    try {
      updateJob(job, { status: "running", message: "正在搜索正文" });
      const searchResult = await searchNovelContent(
        query,
        (current) => {
          updateJob(job, {
            totalBooks: current.totalBooks,
            scannedBooks: current.searchedBooks,
            resultCount: current.resultCount,
            results: current.results,
            progress: progress(current.searchedBooks, current.totalBooks),
            message: current.searchedBooks > 0 ? "正在核对索引命中的正文" : "正在从全文索引筛选",
          });
        },
        { isCancelled: () => Boolean(job.cancelRequested), candidateNovelIds: options.candidateNovelIds },
      );

      updateJob(job, {
        status: "done",
        progress: 100,
        resultCount: searchResult.results.length,
        results: searchResult.results,
        message: searchResult.results.length ? `找到 ${searchResult.results.length} 条匹配内容` : "未找到匹配正文",
      });
      setCachedContentSearchResults(query, searchResult.results, cacheVersion, options.cacheScope);
    } catch (error) {
      const cancelled = error instanceof ContentSearchCancelledError || job.cancelRequested;
      updateJob(job, {
        status: cancelled ? "cancelled" : "error",
        progress: 100,
        error: cancelled ? undefined : error instanceof Error ? error.message : "全文搜索失败",
        message: cancelled ? "全文搜索任务已取消" : "全文搜索失败",
      });
    }
  });

  return getContentJob(job.id) || job;
}

export function startContentIndexJob(options: { force?: boolean; sourceId?: number } = {}): ContentJobSnapshot {
  const requestedSource = options.sourceId ? getNovelSourceById(options.sourceId) : null;
  if (options.sourceId && !requestedSource) throw new Error("小说书库不存在");
  if (requestedSource && !isNovelSourceFullTextSearchEnabled(requestedSource.slug)) {
    throw new Error("轻量书库不创建全文索引");
  }
  const sources = requestedSource
    ? [requestedSource]
    : listNovelSources({ includeEmpty: true }).filter((source) => isNovelSourceFullTextSearchEnabled(source.slug));
  const job = createJob(
    "index",
    options.force ? "正在准备完整重建" : "正在准备增量构建",
    requestedSource?.id || null,
    requestedSource?.name,
  );

  scheduleJob(async () => {
    try {
      const totalBooks = sources.reduce((total, source) => total + source.novelCount, 0);
      let scannedBooks = 0;
      let indexedBooks = 0;
      let reusedBooks = 0;
      let failedBooks = 0;
      updateJob(job, { status: "running", totalBooks, message: options.force ? "正在完整重建全文索引" : "正在增量构建全文索引" });
      for (const source of sources) {
        const before = { scannedBooks, indexedBooks, reusedBooks, failedBooks };
        const result = await buildContentSearchSourceIndex(
          getDb(),
          source.id,
          (current) => {
            updateJob(job, {
              totalBooks,
              scannedBooks: before.scannedBooks + current.processedBooks,
              indexedBooks: before.indexedBooks + current.indexedBooks,
              reusedBooks: before.reusedBooks + current.reusedBooks,
              failedBooks: before.failedBooks + current.failedBooks,
              progress: progress(before.scannedBooks + current.processedBooks, totalBooks),
              message: `${source.name}：${options.force ? "正在完整重建" : "正在增量构建"}`,
            });
          },
          {
            force: options.force,
            isCancelled: () => Boolean(job.cancelRequested),
          },
        );
        scannedBooks += result.processedBooks;
        indexedBooks += result.indexedBooks;
        reusedBooks += result.reusedBooks;
        failedBooks += result.failedBooks;
      }

      updateJob(job, {
        status: "done",
        progress: 100,
        totalBooks,
        scannedBooks,
        indexedBooks,
        reusedBooks,
        failedBooks,
        message: failedBooks
          ? `索引构建完成，更新 ${indexedBooks} 本，复用 ${reusedBooks} 本，失败 ${failedBooks} 本`
          : `索引构建完成，更新 ${indexedBooks} 本，复用 ${reusedBooks} 本`,
      });
      invalidateContentSearchResultCache();
    } catch (error) {
      const cancelled = error instanceof ContentSearchIndexCancelledError || job.cancelRequested;
      invalidateContentSearchResultCache();
      updateJob(job, {
        status: cancelled ? "cancelled" : "error",
        progress: 100,
        error: cancelled ? undefined : error instanceof Error ? error.message : "全文索引构建失败",
        message: cancelled
          ? options.force
            ? "索引任务已取消，原有分片保持不变"
            : "索引任务已取消，已完成的增量批次仍可使用"
          : "全文索引构建失败",
      });
    }
  });

  return getContentJob(job.id) || job;
}
