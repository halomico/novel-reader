import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";

export type PostgresReadingProgress = Readonly<{
  historyId: number;
  novelId: number;
  chapterId: number | null;
  title: string;
  segmentIndex: number;
  segmentRatio: number;
  progressPercent: number;
  contentVersion: string;
  completed: boolean;
  visitCount: number;
  lastReadAt: string;
}>;

export type PostgresReadingProgressPage = Readonly<{
  items: PostgresReadingProgress[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

export type PostgresReadingProgressUpdate = Readonly<{
  chapterId?: number | null;
  segmentIndex: number;
  segmentRatio: number;
  progressPercent: number;
  contentVersion: string;
  completed: boolean;
  savedAt?: number;
}>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

type ProgressRow = QueryResultRow & {
  id: string | number;
  novel_id: number;
  chapter_id: number | null;
  title: string;
  segment_index: number;
  segment_ratio: number;
  progress_percent: number;
  content_version: string;
  completed: boolean;
  visit_count: string | number;
  client_saved_at_ms: string | number;
  last_read_at: Date | string;
};

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function safeNonnegativeInteger(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function boundedNumber(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return Math.min(Math.max(value, minimum), maximum);
}

function contentVersion(value: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 200 || value.includes("\0") || !value.isWellFormed()) {
    throw new TypeError("Invalid PostgreSQL reading content version");
  }
  return value;
}

function title(value: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096 || value.includes("\0") || !value.isWellFormed()) {
    throw new TypeError("Invalid PostgreSQL reading title");
  }
  return value;
}

function isoTimestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL reading timestamp");
  return parsed.toISOString();
}

function toProgress(row: ProgressRow): PostgresReadingProgress {
  return {
    historyId: positiveId(safeNonnegativeInteger(row.id, "reading history id"), "reading history id"),
    novelId: positiveId(row.novel_id, "novel id"),
    chapterId: row.chapter_id === null ? null : positiveId(row.chapter_id, "chapter id"),
    title: row.title,
    segmentIndex: safeNonnegativeInteger(row.segment_index, "reading segment"),
    segmentRatio: boundedNumber(Number(row.segment_ratio), 0, 1, "reading segment ratio"),
    progressPercent: boundedNumber(Number(row.progress_percent), 0, 100, "reading percent"),
    contentVersion: row.content_version,
    completed: row.completed === true,
    visitCount: safeNonnegativeInteger(row.visit_count, "reading visit count"),
    lastReadAt: isoTimestamp(row.last_read_at),
  };
}

const PROGRESS_COLUMNS = `id, novel_id, chapter_id, title, segment_index, segment_ratio,
  progress_percent, content_version, completed, visit_count, client_saved_at_ms, last_read_at`;

export async function getPostgresReadingProgress(
  executor: SqlExecutor,
  userIdValue: number,
  novelIdValue: number,
): Promise<PostgresReadingProgress | null> {
  const result = await executor.query<ProgressRow>({
    name: "reading-progress-by-novel-v1",
    text: `SELECT ${PROGRESS_COLUMNS} FROM user_reading_history
      WHERE user_id = $1 AND novel_id = $2`,
    values: [positiveId(userIdValue, "user id"), positiveId(novelIdValue, "novel id")],
  });
  return result.rows[0] ? toProgress(result.rows[0]) : null;
}

/** Accepts either the immutable source-byte revision or the atomically published
 * Unicode revision. Both are PostgreSQL catalog facts; no legacy datastore is
 * consulted and stale revisions fail closed. */
export async function isCurrentPostgresReadingContentVersion(
  executor: SqlExecutor,
  novelIdValue: number,
  chapterIdValue: number | null,
  versionValue: string,
): Promise<boolean> {
  const novelId = positiveId(novelIdValue, "novel id");
  const chapterId = chapterIdValue === null ? null : positiveId(chapterIdValue, "chapter id");
  const version = contentVersion(versionValue);
  const result = await executor.query<QueryResultRow & { current: boolean }>({
    text: chapterId === null
      ? `SELECT EXISTS (SELECT 1 FROM novels
          WHERE id = $1 AND ($3 = content_hash OR $3 = published_content_version)) AS current`
      : `SELECT EXISTS (SELECT 1 FROM novel_chapters
          WHERE novel_id = $1 AND id = $2
            AND ($3 = content_hash OR $3 = published_content_version)) AS current`,
    values: [novelId, chapterId, version],
  });
  return result.rows[0]?.current === true;
}

function normalizeSavedAt(value: number | undefined): number {
  const savedAt = value ?? Date.now();
  if (!Number.isSafeInteger(savedAt) || savedAt < 1 || savedAt > Date.now() + 5 * 60_000) {
    throw new TypeError("Invalid PostgreSQL reading client timestamp");
  }
  return savedAt;
}

export async function updatePostgresReadingProgress(
  input: {
    userId: number;
    novelId: number;
    chapterId?: number | null;
    title: string;
    contentVersion: string;
    segmentIndex: number;
    segmentRatio: number;
    progressPercent: number;
    completed: boolean;
    savedAt?: number;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<{ saved: boolean; progress: PostgresReadingProgress | null }> {
  const userId = positiveId(input.userId, "user id");
  const novelId = positiveId(input.novelId, "novel id");
  const chapterId = input.chapterId == null ? null : positiveId(input.chapterId, "chapter id");
  const normalizedTitle = title(input.title);
  const version = contentVersion(input.contentVersion);
  const segmentIndex = Math.floor(boundedNumber(input.segmentIndex, 0, 2_147_483_647, "reading segment"));
  const segmentRatio = boundedNumber(input.segmentRatio, 0, 1, "reading segment ratio");
  const progressPercent = boundedNumber(input.progressPercent, 0, 100, "reading percent");
  if (typeof input.completed !== "boolean") throw new TypeError("Invalid PostgreSQL reading completion state");
  const savedAt = normalizeSavedAt(input.savedAt);

  return transaction(async (tx) => {
    const existingResult = await tx.query<ProgressRow>({
      text: `SELECT ${PROGRESS_COLUMNS} FROM user_reading_history
        WHERE user_id = $1 AND novel_id = $2 FOR UPDATE`,
      values: [userId, novelId],
    });
    const existingRow = existingResult.rows[0];
    const existing = existingRow ? toProgress(existingRow) : null;
    if (existingRow && safeNonnegativeInteger(existingRow.client_saved_at_ms, "reading client timestamp") > savedAt) {
      return { saved: false, progress: existing };
    }
    const versionChanged = Boolean(existing?.contentVersion && existing.contentVersion !== version);
    const previousPercent = versionChanged ? 0 : existing?.progressPercent ?? 0;
    const previousCompleted = versionChanged ? false : existing?.completed ?? false;
    const completed = input.completed || progressPercent >= 98;
    const moved = !existing || versionChanged || existing.segmentIndex !== segmentIndex ||
      existing.chapterId !== chapterId || Math.abs(existing.segmentRatio - segmentRatio) >= 0.02 ||
      Math.abs(previousPercent - progressPercent) >= 0.5 || completed !== previousCompleted;
    if (!moved) return { saved: false, progress: existing };
    const nextCompleted = previousCompleted || completed;
    const completionDelta = nextCompleted && !previousCompleted ? 1 : 0;

    const saved = await tx.query<ProgressRow>({
      text: `INSERT INTO user_reading_history (
          user_id, novel_id, chapter_id, title, segment_index, segment_ratio,
          progress_percent, content_version, completed, recorded_in_history, visit_count,
          client_saved_at_ms, last_read_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, 0, $10,
          clock_timestamp(), clock_timestamp(), clock_timestamp())
        ON CONFLICT (user_id, novel_id) DO UPDATE SET
          title = EXCLUDED.title, chapter_id = EXCLUDED.chapter_id,
          segment_index = EXCLUDED.segment_index, segment_ratio = EXCLUDED.segment_ratio,
          progress_percent = EXCLUDED.progress_percent, content_version = EXCLUDED.content_version,
          completed = EXCLUDED.completed, recorded_in_history = TRUE,
          client_saved_at_ms = EXCLUDED.client_saved_at_ms,
          last_read_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE user_reading_history.client_saved_at_ms <= EXCLUDED.client_saved_at_ms
        RETURNING ${PROGRESS_COLUMNS}`,
      values: [userId, novelId, chapterId, normalizedTitle, segmentIndex, segmentRatio,
        progressPercent, version, nextCompleted, savedAt],
    });
    const progressRow = saved.rows[0];
    if (!progressRow) return { saved: false, progress: existing };
    await tx.query({
      text: `INSERT INTO novel_read_daily_stats
        (day, novel_id, completion_count, progress_sample_count, progress_percent_sum, updated_at)
        VALUES (CURRENT_DATE, $1, $2, 1, $3, clock_timestamp())
        ON CONFLICT (day, novel_id) DO UPDATE SET
          completion_count = novel_read_daily_stats.completion_count + EXCLUDED.completion_count,
          progress_sample_count = novel_read_daily_stats.progress_sample_count + 1,
          progress_percent_sum = novel_read_daily_stats.progress_percent_sum + EXCLUDED.progress_percent_sum,
          updated_at = clock_timestamp()`,
      values: [novelId, completionDelta, progressPercent],
    });
    await tx.query({
      text: `INSERT INTO user_read_daily_stats
        (day, user_id, completion_count, progress_update_count, updated_at)
        VALUES (CURRENT_DATE, $1, $2, 1, clock_timestamp())
        ON CONFLICT (day, user_id) DO UPDATE SET
          completion_count = user_read_daily_stats.completion_count + EXCLUDED.completion_count,
          progress_update_count = user_read_daily_stats.progress_update_count + 1,
          updated_at = clock_timestamp()`,
      values: [userId, completionDelta],
    });
    return { saved: true, progress: toProgress(progressRow) };
  });
}

function normalizedPage(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(Math.floor(value!), 1) : 1;
}

function normalizedPageSize(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value!), 1), 100) : 20;
}

export async function listPostgresReadingProgressPage(
  executor: SqlExecutor,
  userIdValue: number,
  params: { page?: number; pageSize?: number } = {},
): Promise<PostgresReadingProgressPage> {
  const userId = positiveId(userIdValue, "user id");
  const requestedPage = normalizedPage(params.page);
  const pageSize = normalizedPageSize(params.pageSize);
  const result = await executor.query<ProgressRow & { total_items: string | number }>({
    text: `WITH visible AS MATERIALIZED (
        SELECT h.*, n.title AS current_title,
          max(CASE WHEN h.completed = FALSE AND h.progress_percent > 0 THEN h.last_read_at END)
            OVER () AS latest_incomplete_at
        FROM user_reading_history h
        JOIN novels n ON n.id = h.novel_id
        WHERE h.user_id = $1 AND h.recorded_in_history = TRUE
      ), counted AS (
        SELECT count(*)::bigint AS total_items FROM visible
      ), pagination AS (
        SELECT total_items,
          least($3::bigint, greatest(ceil(total_items::numeric / $2::numeric)::bigint, 1))::integer AS page
        FROM counted
      )
      SELECT v.id, v.novel_id, v.chapter_id, v.current_title AS title, v.segment_index,
        v.segment_ratio, v.progress_percent, v.content_version, v.completed, v.visit_count,
        v.client_saved_at_ms, v.last_read_at, pagination.total_items, pagination.page
      FROM pagination
      LEFT JOIN LATERAL (
        SELECT * FROM visible
        ORDER BY CASE WHEN last_read_at = latest_incomplete_at AND completed = FALSE AND progress_percent > 0
          THEN 0 ELSE 1 END, last_read_at DESC, id DESC
        LIMIT $2 OFFSET ((pagination.page - 1) * $2)
      ) v ON TRUE`,
    values: [userId, pageSize, requestedPage],
  });
  const totalItems = result.rows[0] ? safeNonnegativeInteger(result.rows[0].total_items, "reading history total") : 0;
  const totalPages = Math.max(Math.ceil(totalItems / pageSize), 1);
  const page = result.rows[0] && Number.isSafeInteger(Number((result.rows[0] as QueryResultRow).page))
    ? Number((result.rows[0] as QueryResultRow).page)
    : 1;
  return {
    items: result.rows.filter((row) => row.id !== null && row.id !== undefined).map(toProgress),
    page,
    pageSize,
    totalItems,
    totalPages,
  };
}

export async function hidePostgresReadingProgress(
  executor: SqlExecutor,
  userIdValue: number,
  novelIds?: readonly number[],
): Promise<number> {
  const userId = positiveId(userIdValue, "user id");
  const ids = novelIds === undefined
    ? null
    : [...new Set(novelIds.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 100);
  if (ids?.length === 0) return 0;
  const result = await executor.query({
    text: `UPDATE user_reading_history SET recorded_in_history = FALSE, updated_at = clock_timestamp()
      WHERE user_id = $1 AND recorded_in_history = TRUE
        AND ($2::integer[] IS NULL OR novel_id = ANY($2::integer[]))`,
    values: [userId, ids],
  });
  return result.rowCount ?? 0;
}
