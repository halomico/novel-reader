import "dotenv/config";

import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { closePostgresPools, database } from "@/core/db/postgres";
import {
  claimNextPostgresContentJob,
  completePostgresContentJob,
  failPostgresContentJob,
  heartbeatPostgresContentJob,
  recoverExpiredPostgresContentJobLeases,
  updatePostgresContentJobProgress,
  type ClaimedPostgresContentJob,
  type ContentJobLease,
} from "@/core/jobs/postgres-content-jobs";
import { cleanupContentGenerations, cleanupRetiredContentGenerations } from "@/domains/reading/postgres-content";
import {
  contentIndexJobProgress,
  parsePostgresContentIndexJobPayload,
  type PostgresContentIndexJobProgress,
} from "@/domains/reading/postgres-content-index-job";
import {
  countPostgresContentReindexCandidates,
  listPostgresContentReindexCandidates,
  reindexPostgresContentCandidate,
  type PostgresContentReindexCandidate,
  type PostgresContentOwnerKind,
} from "@/domains/reading/postgres-content-reindex";

function duration(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, minimum), maximum) : fallback;
}

const POLL_INTERVAL_MS = duration("CONTENT_JOB_POLL_INTERVAL_MS", 1_000, 250, 60_000);
const LEASE_MS = duration("CONTENT_JOB_LEASE_MS", 120_000, 30_000, 900_000);
const HEARTBEAT_MS = Math.max(Math.floor(LEASE_MS / 4), 5_000);
const BATCH_SIZE = duration("CONTENT_INDEX_BATCH_SIZE", 10, 1, 100);
const CONCURRENCY = duration("CONTENT_INDEX_CONCURRENCY", 2, 1, 8);
const WORKER_ID = `${os.hostname()}:${process.pid}:${randomUUID()}`.slice(0, 128);

class ContentJobCancelledError extends Error {
  constructor() { super("PostgreSQL content index job was cancelled"); }
}

class ContentJobLeaseLostError extends Error {
  constructor() { super("PostgreSQL content index job lease was lost"); }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function jobHeartbeat(lease: ContentJobLease, controller: AbortController): () => void {
  let pending = false;
  const timer = setInterval(() => {
    if (pending || controller.signal.aborted) return;
    pending = true;
    heartbeatPostgresContentJob(lease, LEASE_MS)
      .then((result) => {
        if (!result) controller.abort(new ContentJobLeaseLostError());
        else if (result.cancelRequested) controller.abort(new ContentJobCancelledError());
      })
      .catch((error: unknown) => controller.abort(error))
      .finally(() => { pending = false; });
  }, HEARTBEAT_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

async function persistProgress(
  lease: ContentJobLease,
  progress: PostgresContentIndexJobProgress,
  controller: AbortController,
): Promise<void> {
  const result = await updatePostgresContentJobProgress(lease, contentIndexJobProgress(progress));
  if (!result) {
    controller.abort(new ContentJobLeaseLostError());
    throw controller.signal.reason;
  }
  if (result.cancelRequested) {
    controller.abort(new ContentJobCancelledError());
    throw controller.signal.reason;
  }
}

async function processCandidateBatch(
  candidates: readonly PostgresContentReindexCandidate[],
  libraryRoot: string,
  controller: AbortController,
): Promise<{ indexed: number; bytes: number }> {
  let next = 0;
  let indexed = 0;
  let bytes = 0;
  let failure: unknown;
  const workers = Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, async () => {
    while (!failure && !controller.signal.aborted) {
      const candidate = candidates[next];
      next += 1;
      if (!candidate) return;
      try {
        const result = await reindexPostgresContentCandidate(candidate, libraryRoot, controller.signal);
        indexed += 1;
        bytes += result.bytes;
      } catch (error) {
        failure ??= error;
        controller.abort(error);
      }
    }
  });
  await Promise.all(workers);
  if (failure) throw failure;
  controller.signal.throwIfAborted();
  return { indexed, bytes };
}

/** A rebuild retires one generation per published document. Reclaiming them after each
 *  batch lets autovacuum hand the space to the next batch, so a full rebuild stays near
 *  the library's compact size instead of holding two copies until the job ends. */
async function reclaimRetiredGenerations(signal: AbortSignal): Promise<void> {
  while (true) {
    signal.throwIfAborted();
    const deleted = await cleanupRetiredContentGenerations(database("jobs"), 64);
    if (deleted.generationsDeleted === 0) return;
  }
}

async function executeIndexJob(
  job: ClaimedPostgresContentJob,
  shutdownSignal: AbortSignal,
): Promise<PostgresContentIndexJobProgress> {
  const payload = parsePostgresContentIndexJobPayload(job.payload);
  const controller = new AbortController();
  const forwardShutdown = () => controller.abort(shutdownSignal.reason);
  shutdownSignal.addEventListener("abort", forwardShutdown, { once: true });
  const stopHeartbeat = jobHeartbeat(job.lease, controller);
  try {
    const filters = { novelId: payload.novelId, sourceId: payload.sourceId, force: payload.force };
    const counts = await Promise.all([
      countPostgresContentReindexCandidates(database("jobs"), "novel", filters),
      countPostgresContentReindexCandidates(database("jobs"), "chapter", filters),
    ]);
    const progress: PostgresContentIndexJobProgress = contentIndexJobProgress({
      phase: "indexing",
      message: payload.force ? "正在原子重建 PostgreSQL 正文" : "正在增量更新 PostgreSQL 正文",
      percent: counts[0] + counts[1] === 0 ? 99 : 0,
      totalDocuments: counts[0] + counts[1],
    });
    await persistProgress(job.lease, progress, controller);
    const libraryRoot = path.resolve(process.env.NOVEL_LIBRARY_DIR?.trim() || "./library/books");
    for (const kind of ["novel", "chapter"] as const satisfies readonly PostgresContentOwnerKind[]) {
      let cursor = 0;
      while (true) {
        controller.signal.throwIfAborted();
        const candidates = await listPostgresContentReindexCandidates(database("jobs"), kind, {
          ...filters,
          cursor,
          limit: BATCH_SIZE,
        });
        if (!candidates.length) break;
        const result = await processCandidateBatch(candidates, libraryRoot, controller);
        progress.processedDocuments += candidates.length;
        progress.indexedDocuments += result.indexed;
        progress.bytes += result.bytes;
        progress.percent = progress.totalDocuments
          ? Math.min(Math.floor((progress.processedDocuments / progress.totalDocuments) * 100), 99)
          : 99;
        cursor = candidates.at(-1)!.ownerId;
        await persistProgress(job.lease, progress, controller);
        await reclaimRetiredGenerations(controller.signal);
      }
    }
    progress.phase = "cleanup";
    progress.message = "正在回收 PostgreSQL 旧正文分代";
    progress.percent = 99;
    await persistProgress(job.lease, progress, controller);
    while (true) {
      controller.signal.throwIfAborted();
      const deleted = await cleanupContentGenerations(database("jobs"), 10_000);
      if (deleted.blocksDeleted === 0 && deleted.generationsDeleted === 0) break;
    }
    return contentIndexJobProgress({
      ...progress,
      phase: "complete",
      message: progress.indexedDocuments > 0
        ? `PostgreSQL 正文更新完成，共发布 ${progress.indexedDocuments} 个文档`
        : "PostgreSQL 正文已经是最新版本",
      percent: 100,
    });
  } finally {
    stopHeartbeat();
    shutdownSignal.removeEventListener("abort", forwardShutdown);
  }
}

async function main(): Promise<void> {
  const shutdown = new AbortController();
  const requestShutdown = (signal: string) => {
    process.stdout.write(`${JSON.stringify({ event: "postgres.content.worker.draining", signal })}\n`);
    shutdown.abort(new Error(`Worker received ${signal}`));
  };
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.stdout.write(`${JSON.stringify({ event: "postgres.content.worker.started", workerId: WORKER_ID })}\n`);
  while (!shutdown.signal.aborted) {
    await recoverExpiredPostgresContentJobLeases({ limit: 100 });
    const job = await claimNextPostgresContentJob({
      owner: WORKER_ID,
      leaseMs: LEASE_MS,
      kinds: ["search-index"],
    });
    if (!job) {
      await wait(POLL_INTERVAL_MS, shutdown.signal);
      continue;
    }
    process.stdout.write(`${JSON.stringify({ event: "postgres.content.worker.claimed", jobId: job.id, attempt: job.attempts })}\n`);
    try {
      const progress = await executeIndexJob(job, shutdown.signal);
      const completed = await completePostgresContentJob(job.lease, progress);
      if (!completed) throw new ContentJobLeaseLostError();
    } catch (error) {
      if (shutdown.signal.aborted) {
        await failPostgresContentJob(job.lease, shutdown.signal.reason, { retryable: true });
        break;
      }
      const terminal = error instanceof ContentJobCancelledError || error instanceof TypeError;
      await failPostgresContentJob(job.lease, error, { retryable: !terminal });
      process.stderr.write(`${JSON.stringify({
        event: "postgres.content.worker.failed",
        jobId: job.id,
        message: error instanceof Error ? error.message : String(error),
      })}\n`);
    }
  }
  process.stdout.write(`${JSON.stringify({ event: "postgres.content.worker.stopped", workerId: WORKER_ID })}\n`);
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => closePostgresPools());
