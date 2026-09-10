import type {
  JobPayload,
  JobProgress,
  PostgresContentJob,
} from "@/core/jobs/postgres-content-jobs";

export type PostgresContentIndexJobPayload = {
  force: boolean;
  sourceId?: number;
  novelId?: number;
};

export type PostgresContentIndexJobProgress = {
  phase: "queued" | "indexing" | "cleanup" | "complete";
  message: string;
  percent: number;
  totalDocuments: number;
  processedDocuments: number;
  indexedDocuments: number;
  failedDocuments: number;
  bytes: number;
};

export type PostgresContentIndexJobSnapshot = PostgresContentIndexJobProgress & {
  id: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

function optionalId(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 2_147_483_647) {
    throw new TypeError(`Invalid PostgreSQL content index ${label}`);
  }
  return Number(value);
}

export function parsePostgresContentIndexJobPayload(payload: JobPayload): PostgresContentIndexJobPayload {
  const keys = Object.keys(payload);
  if (keys.some((key) => key !== "force" && key !== "sourceId" && key !== "novelId") ||
      (payload.force !== undefined && typeof payload.force !== "boolean")) {
    throw new TypeError("Invalid PostgreSQL content index job payload");
  }
  return {
    force: payload.force === true,
    sourceId: optionalId(payload.sourceId, "source id"),
    novelId: optionalId(payload.novelId, "novel id"),
  };
}

function finiteCount(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function percent(value: unknown, fallback = 0): number {
  const candidate = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(candidate, 0), 100);
}

function phase(value: unknown): PostgresContentIndexJobProgress["phase"] {
  return value === "indexing" || value === "cleanup" || value === "complete" ? value : "queued";
}

export function contentIndexJobProgress(
  value: Partial<PostgresContentIndexJobProgress> = {},
): PostgresContentIndexJobProgress & JobProgress {
  const totalDocuments = finiteCount(value.totalDocuments);
  const processedDocuments = Math.min(finiteCount(value.processedDocuments), totalDocuments || Number.MAX_SAFE_INTEGER);
  const indexedDocuments = Math.min(finiteCount(value.indexedDocuments), processedDocuments);
  const failedDocuments = Math.min(finiteCount(value.failedDocuments), processedDocuments);
  return {
    phase: phase(value.phase),
    message: typeof value.message === "string" ? Array.from(value.message.trim()).slice(0, 240).join("") : "正在等待索引任务",
    percent: percent(value.percent),
    totalDocuments,
    processedDocuments,
    indexedDocuments,
    failedDocuments,
    bytes: finiteCount(value.bytes),
  };
}

export function toPostgresContentIndexJobSnapshot(job: PostgresContentJob): PostgresContentIndexJobSnapshot {
  if (job.kind !== "search-index") throw new Error("Content job is not a PostgreSQL search-index job");
  const progress = contentIndexJobProgress(job.progress as Partial<PostgresContentIndexJobProgress>);
  const defaultMessage = job.status === "queued"
    ? "正在等待索引任务"
    : job.status === "running"
      ? "正在构建 PostgreSQL 正文索引"
      : job.status === "done"
        ? "PostgreSQL 正文索引已更新"
        : job.status === "cancelled"
          ? "索引任务已取消"
          : "索引任务失败";
  const storedMessage = typeof job.progress.message === "string" ? job.progress.message.trim() : "";
  return {
    ...progress,
    message: storedMessage || defaultMessage,
    id: job.id,
    status: job.status,
    error: job.lastError,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}
