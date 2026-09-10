import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  boundedContentJobError,
  cancelPostgresContentJobs,
  claimNextPostgresContentJob,
  completePostgresContentJob,
  enqueuePostgresContentJob,
  failPostgresContentJob,
  getPostgresContentJob,
  getPostgresContentJobQueueStats,
  heartbeatPostgresContentJob,
  POSTGRES_CONTENT_JOB_KINDS,
  readPostgresContentJobCancellation,
  recoverExpiredPostgresContentJobLeases,
  requestPostgresContentJobCancellation,
  updatePostgresContentJobProgress,
} from "./postgres-content-jobs";

const JOB_ID = "00000000-0000-4000-8000-000000000001";
const LEASE_TOKEN = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-07T00:00:00.000Z");

test("runtime queue exposes only the implemented PostgreSQL index job", () => {
  assert.deepEqual(POSTGRES_CONTENT_JOB_KINDS, ["search-index"]);
});

function jobRow(overrides: Record<string, unknown> = {}): QueryResultRow {
  return {
    id: JOB_ID,
    kind: "search-index",
    dedupe_key: "source:1",
    payload: { sourceId: 1 },
    status: "queued",
    priority: 0,
    attempts: 0,
    max_attempts: 5,
    available_at: NOW,
    cancel_requested: false,
    lease_owner: null,
    lease_token: null,
    lease_expires_at: null,
    progress: {},
    last_error: null,
    created_at: NOW,
    updated_at: NOW,
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function scriptedExecutor(rows: readonly (readonly QueryResultRow[])[]) {
  const queries: SqlQuery[] = [];
  let call = 0;
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery): Promise<QueryResult<Row>> {
      queries.push(query);
      const resultRows = rows[call++] ?? [];
      return {
        command: "UPDATE",
        rowCount: resultRows.length,
        oid: 0,
        fields: [],
        rows: resultRows as Row[],
      };
    },
  };
  return { executor, queries };
}

test("enqueue validates and bounds JSON before issuing SQL", async () => {
  const mock = scriptedExecutor([[jobRow({ inserted: true })]]);
  const result = await enqueuePostgresContentJob({
    id: JOB_ID,
    kind: "search-index",
    dedupeKey: "  source:1  ",
    payload: { sourceId: 1 },
    priority: 7,
  }, mock.executor);

  assert.equal(result.inserted, true);
  assert.equal(result.job.dedupeKey, "source:1");
  assert.match(mock.queries[0].text, /ON CONFLICT \(kind, dedupe_key\).*status IN \('queued', 'running'\)/s);
  assert.equal(mock.queries[0].values?.[2], "source:1");
  assert.equal(mock.queries[0].values?.[3], '{"sourceId":1}');

  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await assert.rejects(
    enqueuePostgresContentJob({ kind: "search-index", dedupeKey: "x", payload: circular as never }, mock.executor),
    /circular references/,
  );
  await assert.rejects(
    enqueuePostgresContentJob({ kind: "search-index", dedupeKey: "x", payload: { value: Number.NaN } }, mock.executor),
    /non-finite number/,
  );
  await assert.rejects(
    enqueuePostgresContentJob({ kind: "search-index", dedupeKey: "x", payload: { body: "界".repeat(70_000) } }, mock.executor),
    /byte limit/,
  );
  assert.equal(mock.queries.length, 1);
});

test("job lookup binds a validated UUID and returns the persisted snapshot", async () => {
  const mock = scriptedExecutor([[jobRow()]]);
  const job = await getPostgresContentJob(JOB_ID, mock.executor);
  assert.equal(job?.id, JOB_ID);
  assert.equal(job?.kind, "search-index");
  assert.match(mock.queries[0].text, /WHERE id = \$1::uuid/u);
  await assert.rejects(getPostgresContentJob("not-a-job", mock.executor), /UUID/);
  assert.equal(mock.queries.length, 1);
});

test("claim uses priority ordering, SKIP LOCKED, attempt budget and a fenced lease", async () => {
  const mock = scriptedExecutor([[
    jobRow({
      status: "running",
      attempts: 1,
      lease_owner: "worker-a",
      lease_token: LEASE_TOKEN,
      lease_expires_at: new Date(NOW.getTime() + 60_000),
      started_at: NOW,
    }),
  ]]);
  const claimed = await claimNextPostgresContentJob({ owner: "worker-a", kinds: ["search-index"] }, mock.executor);

  assert.equal(claimed?.lease.owner, "worker-a");
  assert.equal(claimed?.lease.token, LEASE_TOKEN);
  assert.match(mock.queries[0].text, /FOR UPDATE SKIP LOCKED/);
  assert.match(mock.queries[0].text, /attempts < max_attempts/);
  assert.match(mock.queries[0].text, /priority DESC, available_at, created_at, id/);
  assert.match(mock.queries[0].text, /lease_token = \$3::uuid/);
});

test("all worker mutations require an unexpired owner and lease token", async () => {
  const lease = { jobId: JOB_ID, owner: "worker-a", token: LEASE_TOKEN };
  const mock = scriptedExecutor([
    [{ lease_expires_at: new Date(NOW.getTime() + 60_000), cancel_requested: false }],
    [{ cancel_requested: true }],
    [{ cancel_requested: true }],
    [jobRow({ status: "done", finished_at: NOW })],
  ]);

  await heartbeatPostgresContentJob(lease, 60_000, mock.executor);
  await updatePostgresContentJobProgress(lease, { percent: 50 }, mock.executor);
  assert.equal(await readPostgresContentJobCancellation(lease, mock.executor), true);
  await completePostgresContentJob(lease, { percent: 100 }, mock.executor);

  for (const query of mock.queries) {
    assert.match(query.text, /lease_owner = \$2/);
    assert.match(query.text, /lease_token = \$3::uuid/);
    assert.match(query.text, /lease_expires_at > clock_timestamp\(\)/);
    assert.deepEqual(query.values?.slice(0, 3), [JOB_ID, "worker-a", LEASE_TOKEN]);
  }
});

test("failure retries with bounded exponential backoff and terminal cancellation", async () => {
  const lease = { jobId: JOB_ID, owner: "worker-a", token: LEASE_TOKEN };
  const oversized = "错".repeat(3_000);
  assert.equal(Array.from(boundedContentJobError(oversized)).length, 2_048);

  const mock = scriptedExecutor([[jobRow({ status: "queued", attempts: 2, last_error: "temporary" })]]);
  const failed = await failPostgresContentJob(lease, oversized, {
    baseRetryDelayMs: 2_000,
    maxRetryDelayMs: 60_000,
  }, mock.executor);
  assert.equal(failed?.status, "queued");
  assert.equal(Array.from(String(mock.queries[0].values?.[3])).length, 2_048);
  assert.deepEqual(mock.queries[0].values?.slice(4), [true, 2_000, 60_000]);
  assert.match(mock.queries[0].text, /power\(2::double precision, GREATEST\(job\.attempts - 1, 0\)\)/);
  assert.match(mock.queries[0].text, /WHEN job\.cancel_requested THEN 'cancelled'/);
  assert.match(mock.queries[0].text, /job\.attempts < job\.max_attempts/);
});

test("single and bulk cancellation are monotonic without stealing running leases", async () => {
  const single = scriptedExecutor([[jobRow({ status: "cancelled", cancel_requested: true, finished_at: NOW })]]);
  const cancelled = await requestPostgresContentJobCancellation(JOB_ID, single.executor);
  assert.equal(cancelled?.status, "cancelled");
  assert.match(single.queries[0].text, /SET cancel_requested = true/);
  assert.match(single.queries[0].text, /WHEN status = 'queued' THEN 'cancelled'/);
  assert.doesNotMatch(single.queries[0].text, /lease_owner = NULL/);

  const bulk = scriptedExecutor([[{ prior_status: "queued" }, { prior_status: "running" }, { prior_status: "running" }]]);
  assert.deepEqual(await cancelPostgresContentJobs("search-index", bulk.executor), {
    queuedCancelled: 1,
    runningRequested: 2,
  });
  assert.match(bulk.queries[0].text, /cancel_requested = false/);
  assert.equal(bulk.queries[0].values?.[0], "search-index");
});

test("expired leases recover in bounded SKIP LOCKED batches", async () => {
  const mock = scriptedExecutor([[{ status: "queued" }, { status: "failed" }, { status: "cancelled" }]]);
  const counts = await recoverExpiredPostgresContentJobLeases({ limit: 25 }, mock.executor);
  assert.deepEqual(counts, { requeued: 1, failed: 1, cancelled: 1 });
  assert.match(mock.queries[0].text, /lease_expires_at <= clock_timestamp\(\)/);
  assert.match(mock.queries[0].text, /FOR UPDATE SKIP LOCKED/);
  assert.match(mock.queries[0].text, /attempts >= job\.max_attempts/);
  assert.match(mock.queries[0].text, /lease_owner = NULL/);
  assert.match(mock.queries[0].text, /lease_token = NULL/);
  assert.equal(mock.queries[0].values?.[0], 25);
});

test("queue stats distinguish ready, delayed, expired and cancellation demand", async () => {
  const mock = scriptedExecutor([[
    {
      total: "21", queued: "5", queued_ready: "3", queued_delayed: "2",
      running: "4", running_expired: "1", done: "7", failed: "2",
      cancelled: "3", cancel_requested: "2",
    },
  ]]);
  const stats = await getPostgresContentJobQueueStats(undefined, mock.executor);
  assert.deepEqual(stats, {
    total: 21, queued: 5, queuedReady: 3, queuedDelayed: 2,
    running: 4, runningExpired: 1, done: 7, failed: 2,
    cancelled: 3, cancelRequested: 2,
  });
  assert.match(mock.queries[0].text, /FILTER \(WHERE status = 'queued'/);
});

test("runtime job migration enforces lease, payload and bounded-error invariants", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "migrations/postgres/0006_runtime-jobs.sql"), "utf8");
  assert.match(migration, /content_jobs_lease_shape/);
  assert.match(migration, /lease_token IS NOT NULL/);
  assert.match(migration, /jsonb_typeof\(payload\) = 'object'/);
  assert.match(migration, /content_jobs_error_length/);
  assert.match(migration, /WHERE status = 'queued' AND cancel_requested = false/);
});

test("queue-kind migration removes retired jobs before narrowing the database contract", () => {
  const migration = fs.readFileSync(path.join(process.cwd(), "migrations/postgres/0016_content-job-kind.sql"), "utf8");
  assert.match(migration, /DELETE FROM content_jobs WHERE kind <> 'search-index'/);
  assert.match(migration, /CHECK \(kind = 'search-index'\)/);
});
