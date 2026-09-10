import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, type SqlExecutor } from "@/core/db/postgres";

export const POSTGRES_CONTENT_JOB_KINDS = [
  "search-index",
] as const;

export type PostgresContentJobKind = (typeof POSTGRES_CONTENT_JOB_KINDS)[number];
export type PostgresContentJobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JobPayload = Readonly<Record<string, JsonValue>>;
export type JobProgress = Readonly<Record<string, JsonValue>>;

export type PostgresContentJob = {
  id: string;
  kind: PostgresContentJobKind;
  dedupeKey: string;
  payload: JobPayload;
  status: PostgresContentJobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  cancelRequested: boolean;
  progress: JobProgress;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type ContentJobLease = {
  jobId: string;
  owner: string;
  token: string;
};

export type ClaimedPostgresContentJob = PostgresContentJob & {
  lease: ContentJobLease;
  leaseExpiresAt: Date;
};

export type ContentJobQueueStats = Record<PostgresContentJobStatus, number> & {
  queuedReady: number;
  queuedDelayed: number;
  runningExpired: number;
  cancelRequested: number;
  total: number;
};

type JobRow = QueryResultRow & {
  id: string;
  kind: PostgresContentJobKind;
  dedupe_key: string;
  payload: JobPayload;
  status: PostgresContentJobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  available_at: Date | string;
  cancel_requested: boolean;
  lease_owner: string | null;
  lease_token: string | null;
  lease_expires_at: Date | string | null;
  progress: JobProgress;
  last_error: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  inserted?: boolean;
};

const JOB_RETURNING = `
  id::text AS id, kind, dedupe_key, payload, status, priority, attempts,
  max_attempts, available_at, cancel_requested, lease_owner,
  lease_token::text AS lease_token, lease_expires_at, progress, last_error,
  created_at, updated_at, started_at, finished_at`;
const JOB_KIND_SET = new Set<string>(POSTGRES_CONTENT_JOB_KINDS);
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_PROGRESS_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 20;
const MAX_ERROR_CHARACTERS = 2_048;

function executorOrDefault(executor?: SqlExecutor): SqlExecutor {
  return executor ?? database("jobs");
}

function integer(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function contentJobKind(value: string): PostgresContentJobKind {
  if (!JOB_KIND_SET.has(value)) throw new Error("Unsupported PostgreSQL content job kind");
  return value as PostgresContentJobKind;
}

function boundedText(name: string, value: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > maximum) throw new Error(`${name} must contain between 1 and ${maximum} characters`);
  return normalized;
}

function uuid(name: string, value: string): string {
  const normalized = boundedText(name, value, 64).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)) {
    throw new Error(`${name} must be a UUID`);
  }
  return normalized;
}

function inspectJson(value: unknown, depth: number, ancestors: Set<object>): void {
  if (depth > MAX_JSON_DEPTH) throw new Error(`Job JSON exceeds the maximum depth of ${MAX_JSON_DEPTH}`);
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Job JSON cannot contain a non-finite number");
    return;
  }
  if (typeof value !== "object") throw new Error("Job JSON contains an unsupported value");
  if (ancestors.has(value)) throw new Error("Job JSON cannot contain circular references");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error("Job JSON must contain only arrays and plain objects");
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (const item of value) inspectJson(item, depth + 1, ancestors);
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (key.length > 256) throw new Error("Job JSON object keys cannot exceed 256 characters");
      inspectJson(item, depth + 1, ancestors);
    }
  }
  ancestors.delete(value);
}

function serializedObject(name: string, value: unknown, maximumBytes: number): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
  inspectJson(value, 0, new Set());
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    throw new Error(`${name} exceeds the ${maximumBytes}-byte limit`);
  }
  return serialized;
}

function date(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("PostgreSQL returned an invalid job timestamp");
  return parsed;
}

function nullableDate(value: Date | string | null): Date | null {
  return value === null ? null : date(value);
}

function jobFromRow(row: JobRow): PostgresContentJob {
  return {
    id: row.id,
    kind: contentJobKind(row.kind),
    dedupeKey: row.dedupe_key,
    payload: row.payload,
    status: row.status,
    priority: Number(row.priority),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: date(row.available_at),
    cancelRequested: row.cancel_requested,
    progress: row.progress,
    lastError: row.last_error,
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
    startedAt: nullableDate(row.started_at),
    finishedAt: nullableDate(row.finished_at),
  };
}

function claimedJobFromRow(row: JobRow): ClaimedPostgresContentJob {
  if (!row.lease_owner || !row.lease_token || !row.lease_expires_at) {
    throw new Error("PostgreSQL returned a claimed job without a complete lease");
  }
  return {
    ...jobFromRow(row),
    lease: { jobId: row.id, owner: row.lease_owner, token: row.lease_token },
    leaseExpiresAt: date(row.lease_expires_at),
  };
}

function validateLease(lease: ContentJobLease): ContentJobLease {
  const jobId = uuid("job id", lease.jobId);
  const owner = boundedText("lease owner", lease.owner, 128);
  const token = uuid("lease token", lease.token);
  return { jobId, owner, token };
}

export function boundedContentJobError(error: unknown): string {
  const source = error instanceof Error ? error.message : typeof error === "string" ? error : "Job execution failed";
  const normalized = source.trim() || "Job execution failed";
  return Array.from(normalized).slice(0, MAX_ERROR_CHARACTERS).join("");
}

export async function enqueuePostgresContentJob(input: {
  kind: PostgresContentJobKind;
  dedupeKey: string;
  payload: JobPayload;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
  id?: string;
}, executor?: SqlExecutor): Promise<{ job: PostgresContentJob; inserted: boolean }> {
  const kind = contentJobKind(input.kind);
  const dedupeKey = boundedText("dedupe key", input.dedupeKey, 256);
  const payload = serializedObject("job payload", input.payload, MAX_PAYLOAD_BYTES);
  const priority = integer("priority", input.priority ?? 0, -32_768, 32_767);
  const maxAttempts = integer("max attempts", input.maxAttempts ?? 5, 1, 100);
  const id = input.id ? uuid("job id", input.id) : crypto.randomUUID();
  if (input.availableAt && !Number.isFinite(input.availableAt.getTime())) throw new Error("availableAt must be a valid Date");
  const result = await executorOrDefault(executor).query<JobRow>({
    text: `INSERT INTO content_jobs (
      id, kind, dedupe_key, payload, status, priority, max_attempts, available_at
    ) VALUES ($1::uuid, $2, $3, $4::jsonb, 'queued', $5, $6, COALESCE($7::timestamptz, clock_timestamp()))
    ON CONFLICT (kind, dedupe_key) WHERE status IN ('queued', 'running')
    DO UPDATE SET
      priority = GREATEST(content_jobs.priority, EXCLUDED.priority),
      updated_at = CASE
        WHEN EXCLUDED.priority > content_jobs.priority THEN clock_timestamp()
        ELSE content_jobs.updated_at
      END
    RETURNING ${JOB_RETURNING}, (xmax = 0) AS inserted`,
    values: [id, kind, dedupeKey, payload, priority, maxAttempts, input.availableAt ?? null],
  });
  const row = result.rows[0];
  if (!row) throw new Error("PostgreSQL did not return the enqueued content job");
  return { job: jobFromRow(row), inserted: row.inserted === true };
}

export async function getPostgresContentJob(
  jobId: string,
  executor?: SqlExecutor,
): Promise<PostgresContentJob | null> {
  const result = await executorOrDefault(executor).query<JobRow>({
    text: `SELECT ${JOB_RETURNING} FROM content_jobs WHERE id = $1::uuid`,
    values: [uuid("job id", jobId)],
  });
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

export async function claimNextPostgresContentJob(input: {
  owner: string;
  leaseMs?: number;
  kinds?: readonly PostgresContentJobKind[];
}, executor?: SqlExecutor): Promise<ClaimedPostgresContentJob | null> {
  const owner = boundedText("lease owner", input.owner, 128);
  const leaseMs = integer("lease duration", input.leaseMs ?? 60_000, 1_000, 900_000);
  const kinds = input.kinds?.map(contentJobKind) ?? [...POSTGRES_CONTENT_JOB_KINDS];
  if (kinds.length < 1) throw new Error("At least one job kind is required");
  const leaseToken = crypto.randomUUID();
  const result = await executorOrDefault(executor).query<JobRow>({
    text: `WITH candidate AS (
      SELECT id AS candidate_id
      FROM content_jobs
      WHERE status = 'queued'
        AND cancel_requested = false
        AND attempts < max_attempts
        AND available_at <= clock_timestamp()
        AND kind = ANY($1::text[])
      ORDER BY priority DESC, available_at, created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE content_jobs AS job
    SET status = 'running',
        attempts = job.attempts + 1,
        lease_owner = $2,
        lease_token = $3::uuid,
        lease_expires_at = clock_timestamp() + ($4::double precision * interval '1 millisecond'),
        started_at = COALESCE(job.started_at, clock_timestamp()),
        finished_at = NULL,
        updated_at = clock_timestamp()
    FROM candidate
    WHERE job.id = candidate.candidate_id
    RETURNING ${JOB_RETURNING}`,
    values: [kinds, owner, leaseToken, leaseMs],
  });
  return result.rows[0] ? claimedJobFromRow(result.rows[0]) : null;
}

export async function heartbeatPostgresContentJob(
  leaseInput: ContentJobLease,
  leaseMs = 60_000,
  executor?: SqlExecutor,
): Promise<{ leaseExpiresAt: Date; cancelRequested: boolean } | null> {
  const lease = validateLease(leaseInput);
  integer("lease duration", leaseMs, 1_000, 900_000);
  const result = await executorOrDefault(executor).query<QueryResultRow & {
    lease_expires_at: Date | string;
    cancel_requested: boolean;
  }>({
    text: `UPDATE content_jobs
    SET lease_expires_at = clock_timestamp() + ($4::double precision * interval '1 millisecond'),
        updated_at = clock_timestamp()
    WHERE id = $1::uuid AND status = 'running'
      AND lease_owner = $2 AND lease_token = $3::uuid
      AND lease_expires_at > clock_timestamp()
    RETURNING lease_expires_at, cancel_requested`,
    values: [lease.jobId, lease.owner, lease.token, leaseMs],
  });
  const row = result.rows[0];
  return row ? { leaseExpiresAt: date(row.lease_expires_at), cancelRequested: row.cancel_requested } : null;
}

export async function updatePostgresContentJobProgress(
  leaseInput: ContentJobLease,
  progress: JobProgress,
  executor?: SqlExecutor,
): Promise<{ cancelRequested: boolean } | null> {
  const lease = validateLease(leaseInput);
  const serialized = serializedObject("job progress", progress, MAX_PROGRESS_BYTES);
  const result = await executorOrDefault(executor).query<QueryResultRow & { cancel_requested: boolean }>({
    text: `UPDATE content_jobs
    SET progress = $4::jsonb, updated_at = clock_timestamp()
    WHERE id = $1::uuid AND status = 'running'
      AND lease_owner = $2 AND lease_token = $3::uuid
      AND lease_expires_at > clock_timestamp()
    RETURNING cancel_requested`,
    values: [lease.jobId, lease.owner, lease.token, serialized],
  });
  return result.rows[0] ? { cancelRequested: result.rows[0].cancel_requested } : null;
}

export async function readPostgresContentJobCancellation(
  leaseInput: ContentJobLease,
  executor?: SqlExecutor,
): Promise<boolean | null> {
  const lease = validateLease(leaseInput);
  const result = await executorOrDefault(executor).query<QueryResultRow & { cancel_requested: boolean }>({
    text: `SELECT cancel_requested FROM content_jobs
    WHERE id = $1::uuid AND status = 'running'
      AND lease_owner = $2 AND lease_token = $3::uuid
      AND lease_expires_at > clock_timestamp()`,
    values: [lease.jobId, lease.owner, lease.token],
  });
  return result.rows[0]?.cancel_requested ?? null;
}

export async function completePostgresContentJob(
  leaseInput: ContentJobLease,
  progress: JobProgress = {},
  executor?: SqlExecutor,
): Promise<PostgresContentJob | null> {
  const lease = validateLease(leaseInput);
  const serialized = serializedObject("job progress", progress, MAX_PROGRESS_BYTES);
  const result = await executorOrDefault(executor).query<JobRow>({
    text: `UPDATE content_jobs
    SET status = CASE WHEN cancel_requested THEN 'cancelled' ELSE 'done' END,
        progress = $4::jsonb,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = NULL,
        finished_at = clock_timestamp(),
        updated_at = clock_timestamp()
    WHERE id = $1::uuid AND status = 'running'
      AND lease_owner = $2 AND lease_token = $3::uuid
      AND lease_expires_at > clock_timestamp()
    RETURNING ${JOB_RETURNING}`,
    values: [lease.jobId, lease.owner, lease.token, serialized],
  });
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

export async function failPostgresContentJob(
  leaseInput: ContentJobLease,
  error: unknown,
  options: { retryable?: boolean; baseRetryDelayMs?: number; maxRetryDelayMs?: number } = {},
  executor?: SqlExecutor,
): Promise<PostgresContentJob | null> {
  const lease = validateLease(leaseInput);
  const retryable = options.retryable !== false;
  const baseRetryDelayMs = integer("base retry delay", options.baseRetryDelayMs ?? 1_000, 100, 300_000);
  const maxRetryDelayMs = integer("maximum retry delay", options.maxRetryDelayMs ?? 300_000, baseRetryDelayMs, 3_600_000);
  const result = await executorOrDefault(executor).query<JobRow>({
    text: `UPDATE content_jobs AS job
    SET status = CASE
          WHEN job.cancel_requested THEN 'cancelled'
          WHEN $5::boolean AND job.attempts < job.max_attempts THEN 'queued'
          ELSE 'failed'
        END,
        available_at = CASE
          WHEN NOT job.cancel_requested AND $5::boolean AND job.attempts < job.max_attempts
          THEN clock_timestamp() + (
            LEAST($7::double precision, $6::double precision * power(2::double precision, GREATEST(job.attempts - 1, 0)))
            * interval '1 millisecond'
          )
          ELSE job.available_at
        END,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = CASE WHEN job.cancel_requested THEN NULL ELSE $4 END,
        finished_at = CASE
          WHEN job.cancel_requested OR NOT $5::boolean OR job.attempts >= job.max_attempts THEN clock_timestamp()
          ELSE NULL
        END,
        updated_at = clock_timestamp()
    WHERE job.id = $1::uuid AND job.status = 'running'
      AND job.lease_owner = $2 AND job.lease_token = $3::uuid
      AND job.lease_expires_at > clock_timestamp()
    RETURNING ${JOB_RETURNING}`,
    values: [lease.jobId, lease.owner, lease.token, boundedContentJobError(error), retryable, baseRetryDelayMs, maxRetryDelayMs],
  });
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

export async function requestPostgresContentJobCancellation(
  jobId: string,
  executor?: SqlExecutor,
): Promise<PostgresContentJob | null> {
  const id = uuid("job id", jobId);
  const result = await executorOrDefault(executor).query<JobRow>({
    text: `UPDATE content_jobs
    SET cancel_requested = true,
        status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
        finished_at = CASE WHEN status = 'queued' THEN clock_timestamp() ELSE finished_at END,
        updated_at = CASE WHEN cancel_requested THEN updated_at ELSE clock_timestamp() END
    WHERE id = $1::uuid AND status IN ('queued', 'running')
    RETURNING ${JOB_RETURNING}`,
    values: [id],
  });
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

export async function cancelPostgresContentJobs(
  kind?: PostgresContentJobKind,
  executor?: SqlExecutor,
): Promise<{ queuedCancelled: number; runningRequested: number }> {
  const normalizedKind = kind === undefined ? null : contentJobKind(kind);
  const result = await executorOrDefault(executor).query<QueryResultRow & { prior_status: PostgresContentJobStatus }>({
    text: `UPDATE content_jobs
    SET cancel_requested = true,
        status = CASE WHEN status = 'queued' THEN 'cancelled' ELSE status END,
        finished_at = CASE WHEN status = 'queued' THEN clock_timestamp() ELSE finished_at END,
        updated_at = clock_timestamp()
    WHERE status IN ('queued', 'running')
      AND cancel_requested = false
      AND ($1::text IS NULL OR kind = $1)
    RETURNING CASE WHEN status = 'cancelled' THEN 'queued' ELSE 'running' END AS prior_status`,
    values: [normalizedKind],
  });
  return result.rows.reduce((counts, row) => {
    if (row.prior_status === "queued") counts.queuedCancelled += 1;
    else counts.runningRequested += 1;
    return counts;
  }, { queuedCancelled: 0, runningRequested: 0 });
}

export async function recoverExpiredPostgresContentJobLeases(
  options: { limit?: number; baseRetryDelayMs?: number; maxRetryDelayMs?: number } = {},
  executor?: SqlExecutor,
): Promise<{ requeued: number; failed: number; cancelled: number }> {
  const limit = integer("recovery limit", options.limit ?? 100, 1, 1_000);
  const baseRetryDelayMs = integer("base retry delay", options.baseRetryDelayMs ?? 1_000, 100, 300_000);
  const maxRetryDelayMs = integer("maximum retry delay", options.maxRetryDelayMs ?? 300_000, baseRetryDelayMs, 3_600_000);
  const result = await executorOrDefault(executor).query<QueryResultRow & { status: PostgresContentJobStatus }>({
    text: `WITH candidates AS (
      SELECT id AS candidate_id
      FROM content_jobs
      WHERE (status = 'running' AND lease_expires_at <= clock_timestamp())
         OR (status = 'queued' AND (cancel_requested OR attempts >= max_attempts))
      ORDER BY updated_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT $1
    )
    UPDATE content_jobs AS job
    SET status = CASE
          WHEN job.cancel_requested THEN 'cancelled'
          WHEN job.attempts >= job.max_attempts THEN 'failed'
          ELSE 'queued'
        END,
        available_at = CASE
          WHEN NOT job.cancel_requested AND job.attempts < job.max_attempts
          THEN clock_timestamp() + (
            LEAST($3::double precision, $2::double precision * power(2::double precision, GREATEST(job.attempts - 1, 0)))
            * interval '1 millisecond'
          )
          ELSE job.available_at
        END,
        lease_owner = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        last_error = CASE
          WHEN job.cancel_requested THEN NULL
          WHEN job.attempts >= job.max_attempts THEN COALESCE(job.last_error, 'Job retry budget exhausted')
          ELSE 'Worker lease expired; retrying'
        END,
        finished_at = CASE WHEN job.cancel_requested OR job.attempts >= job.max_attempts THEN clock_timestamp() ELSE NULL END,
        updated_at = clock_timestamp()
    FROM candidates
    WHERE job.id = candidates.candidate_id
    RETURNING job.status`,
    values: [limit, baseRetryDelayMs, maxRetryDelayMs],
  });
  return result.rows.reduce((counts, row) => {
    if (row.status === "queued") counts.requeued += 1;
    else if (row.status === "failed") counts.failed += 1;
    else if (row.status === "cancelled") counts.cancelled += 1;
    return counts;
  }, { requeued: 0, failed: 0, cancelled: 0 });
}

function count(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("PostgreSQL returned an invalid job count");
  return parsed;
}

export async function getPostgresContentJobQueueStats(
  kind?: PostgresContentJobKind,
  executor?: SqlExecutor,
): Promise<ContentJobQueueStats> {
  const normalizedKind = kind === undefined ? null : contentJobKind(kind);
  const result = await executorOrDefault(executor).query<QueryResultRow>({
    text: `SELECT
      count(*) AS total,
      count(*) FILTER (WHERE status = 'queued') AS queued,
      count(*) FILTER (WHERE status = 'queued' AND cancel_requested = false AND available_at <= clock_timestamp()) AS queued_ready,
      count(*) FILTER (WHERE status = 'queued' AND cancel_requested = false AND available_at > clock_timestamp()) AS queued_delayed,
      count(*) FILTER (WHERE status = 'running') AS running,
      count(*) FILTER (WHERE status = 'running' AND lease_expires_at <= clock_timestamp()) AS running_expired,
      count(*) FILTER (WHERE status = 'done') AS done,
      count(*) FILTER (WHERE status = 'failed') AS failed,
      count(*) FILTER (WHERE status = 'cancelled') AS cancelled,
      count(*) FILTER (WHERE cancel_requested) AS cancel_requested
    FROM content_jobs
    WHERE ($1::text IS NULL OR kind = $1)`,
    values: [normalizedKind],
  });
  const row = result.rows[0] ?? {};
  return {
    total: count(row.total ?? 0),
    queued: count(row.queued ?? 0),
    queuedReady: count(row.queued_ready ?? 0),
    queuedDelayed: count(row.queued_delayed ?? 0),
    running: count(row.running ?? 0),
    runningExpired: count(row.running_expired ?? 0),
    done: count(row.done ?? 0),
    failed: count(row.failed ?? 0),
    cancelled: count(row.cancelled ?? 0),
    cancelRequested: count(row.cancel_requested ?? 0),
  };
}
