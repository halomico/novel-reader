import crypto from "node:crypto";
import { ContentIndexCancelledError, type ContentIndexTermStatus } from "./content-index";
import { buildContentIndexTerms } from "./content-index";
import { getManualIndexMaxSegments, isManualIndexMaxSegmentsEnabled } from "./config";
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
  segmentCount: number;
  matchedBooks: number;
  results?: SearchResult[];
  indexStatus?: ContentIndexTermStatus;
  error?: string;
  terms?: string[];
  indexStatuses?: ContentIndexTermStatus[];
  cancelRequested?: boolean;
};

type ContentJob = ContentJobSnapshot;

type JobGlobal = typeof globalThis & {
  novelReaderContentJobs?: Map<string, ContentJob>;
};

const JOB_TTL_MS = 30 * 60 * 1000;

function getJobs(): Map<string, ContentJob> {
  const globalForJobs = globalThis as JobGlobal;
  if (!globalForJobs.novelReaderContentJobs) {
    globalForJobs.novelReaderContentJobs = new Map();
  }
  return globalForJobs.novelReaderContentJobs;
}

function cleanupJobs() {
  const now = Date.now();
  for (const [id, job] of getJobs()) {
    if (now - job.updatedAt > JOB_TTL_MS) {
      getJobs().delete(id);
    }
  }
}

function createJob(kind: JobKind, message: string): ContentJob {
  cleanupJobs();
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
    segmentCount: 0,
    matchedBooks: 0,
  };
  getJobs().set(job.id, job);
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

  scheduleJob(async () => {
    try {
      updateJob(job, { status: "running", message: "正在搜索正文" });
      const searchResult = await searchNovelContent(query, (current) => {
        updateJob(job, {
          totalBooks: current.totalBooks,
          scannedBooks: current.searchedBooks,
          resultCount: current.resultCount,
          segmentCount: current.cacheSegmentCount,
          results: current.results,
          progress: progress(current.searchedBooks, current.totalBooks),
          message:
            current.scanPhase === "prefilter"
              ? "正在快速筛选小说正文"
              : current.scanEngine === "fts5"
                ? "正在从全文索引筛选"
                : current.scanEngine === "ripgrep"
                ? "正在核对候选正文"
                : current.indexedTerm
                  ? `正在从索引“${current.indexedTerm}”筛选`
                  : "正在扫描小说正文",
        });
      }, { isCancelled: () => Boolean(job.cancelRequested) });

      updateJob(job, {
        status: "done",
        progress: 100,
        resultCount: searchResult.results.length,
        results: searchResult.results,
        message: searchResult.results.length ? `找到 ${searchResult.results.length} 条匹配内容` : "未找到匹配正文",
      });
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

export function startContentIndexJob(terms: string[]): ContentJobSnapshot {
  const job = createJob("index", "正在准备添加索引");
  updateJob(job, { terms });

  scheduleJob(async () => {
    try {
      updateJob(job, { status: "running", message: "正在扫描小说正文" });
      const maxSegments = isManualIndexMaxSegmentsEnabled() ? getManualIndexMaxSegments() : null;
      const indexStatuses = await buildContentIndexTerms(
        getDb(),
        terms,
        (current) => {
          updateJob(job, {
            totalBooks: current.totalBooks,
            scannedBooks: current.scannedBooks,
            matchedBooks: current.matchedBooks,
            segmentCount: current.segmentCount,
            progress: progress(current.scannedBooks, current.totalBooks),
            message: `正在建立搜索索引，${current.totalTerms || terms.length} 个词`,
          });
        },
        { source: "manual", maxSegments, isCancelled: () => Boolean(job.cancelRequested) },
      );
      const indexedCount = indexStatuses.filter((item) => item.status === "indexed").length;
      const skippedCount = indexStatuses.filter((item) => item.status === "skipped").length;
      const totalSegments = indexStatuses.reduce((total, item) => total + item.segmentCount, 0);

      updateJob(job, {
        status: "done",
        progress: 100,
        indexStatus: indexStatuses[0],
        indexStatuses,
        segmentCount: totalSegments,
        message:
          skippedCount > 0
            ? `已完成 ${indexedCount} 个索引，跳过 ${skippedCount} 个超过上限的词`
            : `已添加 ${indexedCount} 个索引，合计命中 ${totalSegments} 个片段`,
      });
    } catch (error) {
      const cancelled = error instanceof ContentIndexCancelledError || job.cancelRequested;
      updateJob(job, {
        status: cancelled ? "cancelled" : "error",
        progress: 100,
        error: cancelled ? undefined : error instanceof Error ? error.message : "添加索引失败",
        message: cancelled ? "索引任务已取消，临时数据已清理" : "添加索引失败",
      });
    }
  });

  return getContentJob(job.id) || job;
}
