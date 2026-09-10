import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresContentJob } from "@/core/jobs/postgres-content-jobs";
import {
  contentIndexJobProgress,
  parsePostgresContentIndexJobPayload,
  toPostgresContentIndexJobSnapshot,
} from "./postgres-content-index-job";

test("PostgreSQL content index payload and progress are strict and bounded", () => {
  assert.deepEqual(parsePostgresContentIndexJobPayload({ force: true, sourceId: 7 }), { force: true, sourceId: 7, novelId: undefined });
  assert.throws(() => parsePostgresContentIndexJobPayload({ force: "yes" }), /payload/);
  assert.throws(() => parsePostgresContentIndexJobPayload({ force: false, sourceId: 0 }), /source id/);
  assert.throws(() => parsePostgresContentIndexJobPayload({ force: false, extra: true }), /payload/);
  assert.deepEqual(contentIndexJobProgress({ percent: 120, totalDocuments: 4, processedDocuments: 8, indexedDocuments: 7 }), {
    phase: "queued", message: "正在等待索引任务", percent: 100, totalDocuments: 4,
    processedDocuments: 4, indexedDocuments: 4, failedDocuments: 0, bytes: 0,
  });
});

test("PostgreSQL content jobs expose a minimal serializable admin snapshot", () => {
  const now = new Date("2026-09-08T00:00:00Z");
  const job: PostgresContentJob = {
    id: "00000000-0000-4000-8000-000000000001", kind: "search-index", dedupeKey: "content-index:global",
    payload: { force: false }, status: "running", priority: 0, attempts: 1, maxAttempts: 5,
    availableAt: now, cancelRequested: false,
    progress: { phase: "indexing", message: "正在发布", percent: 50, totalDocuments: 2,
      processedDocuments: 1, indexedDocuments: 1, failedDocuments: 0, bytes: 99 },
    lastError: null, createdAt: now, updatedAt: now, startedAt: now, finishedAt: null,
  };
  const snapshot = toPostgresContentIndexJobSnapshot(job);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.indexedDocuments, 1);
  assert.equal(snapshot.updatedAt, "2026-09-08T00:00:00.000Z");
  assert.equal("payload" in snapshot, false);
});
