import crypto from "node:crypto";
import {
  getCachedContentSearchResults,
  getContentSearchCacheVersion,
  hasCachedContentSearchResults as hasCachedSearchResults,
  setCachedContentSearchResults,
} from "./content-search-cache";
import { getContentSearchDb } from "./content-search-db";
import { buildContentSearchIndex, ContentSearchIndexCancelledError } from "./content-search-index";
import { getDb } from "./db";
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
  results?: SearchResult[];
  error?: string;
  cancelRequested?: boolean;
};

type ContentJob = ContentJobSnapshot;

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

function createJob(kind: JobKind, message: string): ContentJob {
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

export function getContentJob(id: string): ContentJobSnapshot | null {
  cleanupJobs();
  const job = getJobs().get(id);
  return job ? { ...job, results: job.results ? [...job.results] : undefined } : null;
}

export function countActiveContentJobs(kind?: JobKind): number {
  cleanupJobs();
  return Array.from(getJobs().values()).filter(
    (job) => (kind === undefined || job.kind === kind) && (job.status === "queued" || job.status === "running"),
  ).length;
}

export function hasCachedContentSearchResults(query: ParsedSearchQuery): boolean {
  return hasCachedSearchResults(query);
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

export function startContentSearchJob(query: ParsedSearchQuery): ContentJobSnapshot {
  const job = createJob("search", "正在准备全文搜索");
  const cachedResults = getCachedContentSearchResults(query);
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
            message:
              current.scanPhase === "prefilter"
                ? "正在快速筛选小说正文"
                : current.scanEngine === "fts5"
                  ? "正在从全文索引筛选"
                  : current.scanEngine === "ripgrep"
                    ? "正在核对候选正文"
                    : "正在扫描小说正文",
          });
        },
        { isCancelled: () => Boolean(job.cancelRequested) },
      );

      updateJob(job, {
        status: "done",
        progress: 100,
        resultCount: searchResult.results.length,
        results: searchResult.results,
        message: searchResult.results.length ? `找到 ${searchResult.results.length} 条匹配内容` : "未找到匹配正文",
      });
      setCachedContentSearchResults(query, searchResult.results, cacheVersion);
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

export function startContentIndexJob(options: { force?: boolean } = {}): ContentJobSnapshot {
  const job = createJob("index", options.force ? "正在准备完整重建" : "正在准备增量构建");

  scheduleJob(async () => {
    try {
      updateJob(job, { status: "running", message: options.force ? "正在完整重建全文索引" : "正在增量构建全文索引" });
      const result = await buildContentSearchIndex(
        getDb(),
        getContentSearchDb(),
        (current) => {
          updateJob(job, {
            totalBooks: current.totalBooks,
            scannedBooks: current.processedBooks,
            indexedBooks: current.indexedBooks,
            reusedBooks: current.reusedBooks,
            failedBooks: current.failedBooks,
            progress: progress(current.processedBooks, current.totalBooks),
            message: options.force ? "正在完整重建全文索引" : "正在增量构建全文索引",
          });
        },
        { force: options.force, isCancelled: () => Boolean(job.cancelRequested) },
      );

      updateJob(job, {
        status: "done",
        progress: 100,
        totalBooks: result.totalBooks,
        scannedBooks: result.processedBooks,
        indexedBooks: result.indexedBooks,
        reusedBooks: result.reusedBooks,
        failedBooks: result.failedBooks,
        message: result.failedBooks
          ? `索引构建完成，更新 ${result.indexedBooks} 本，复用 ${result.reusedBooks} 本，失败 ${result.failedBooks} 本`
          : `索引构建完成，更新 ${result.indexedBooks} 本，复用 ${result.reusedBooks} 本`,
      });
    } catch (error) {
      const cancelled = error instanceof ContentSearchIndexCancelledError || job.cancelRequested;
      updateJob(job, {
        status: cancelled ? "cancelled" : "error",
        progress: 100,
        error: cancelled ? undefined : error instanceof Error ? error.message : "全文索引构建失败",
        message: cancelled ? "索引任务已取消，已完成的批次仍可继续使用" : "全文索引构建失败",
      });
    }
  });

  return getContentJob(job.id) || job;
}
