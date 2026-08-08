import { getDb } from "./db";
import { mediaThumbnailVersion, type MediaAsset } from "./media";

export type MediaPreparationJobStatus = "pending" | "processing" | "failed";

export type MediaPreparationJob = {
  mediaId: number;
  sourceVersion: number;
  thumbnailPercent: number;
  status: MediaPreparationJobStatus;
  attempts: number;
  nextRunAt: number;
  lockedUntil: number | null;
  lastError: string;
};

type MediaPreparationJobRow = {
  media_id: number;
  source_version: number;
  thumbnail_percent: number;
  status: MediaPreparationJobStatus;
  attempts: number;
  next_run_at: number;
  locked_until: number | null;
  last_error: string;
};

const PREPARATION_LOCK_MS = 5 * 60_000;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000] as const;

function toJob(row: MediaPreparationJobRow): MediaPreparationJob {
  return {
    mediaId: row.media_id,
    sourceVersion: row.source_version,
    thumbnailPercent: row.thumbnail_percent,
    status: row.status,
    attempts: row.attempts,
    nextRunAt: row.next_run_at,
    lockedUntil: row.locked_until,
    lastError: row.last_error,
  };
}

export function mediaAssetNeedsPreparation(asset: MediaAsset, thumbnailPercent: number): boolean {
  if (asset.kind === "video" && (asset.playbackFormat === "hls" || asset.playbackStatus === "processing")) {
    return false;
  }
  const durationReady = asset.kind === "file" || Boolean(asset.durationSeconds && asset.durationSeconds > 0);
  const thumbnailReady =
    asset.kind !== "video" ||
    asset.thumbnailVersion === mediaThumbnailVersion(asset.mtimeMs, thumbnailPercent);
  return !durationReady || !thumbnailReady;
}

export function enqueueMediaPreparationJob(
  asset: MediaAsset,
  thumbnailPercent: number,
  options: { force?: boolean; now?: number } = {},
): boolean {
  const db = getDb();
  if (!mediaAssetNeedsPreparation(asset, thumbnailPercent)) {
    db.prepare("DELETE FROM media_prepare_jobs WHERE media_id = ?").run(asset.id);
    return false;
  }
  const now = Math.floor(options.now ?? Date.now());
  const result = db
    .prepare(
      `INSERT INTO media_prepare_jobs (
         media_id, source_version, thumbnail_percent, status, attempts, next_run_at,
         locked_until, last_error, updated_at
       )
       VALUES (?, ?, ?, 'pending', 0, ?, NULL, '', CURRENT_TIMESTAMP)
       ON CONFLICT(media_id) DO UPDATE SET
         source_version = excluded.source_version,
         thumbnail_percent = excluded.thumbnail_percent,
         status = 'pending',
         attempts = 0,
         next_run_at = excluded.next_run_at,
         locked_until = NULL,
         last_error = '',
         updated_at = CURRENT_TIMESTAMP
       WHERE media_prepare_jobs.source_version <> excluded.source_version
          OR media_prepare_jobs.thumbnail_percent <> excluded.thumbnail_percent
          OR ? = 1`,
    )
    .run(
      asset.id,
      Math.floor(asset.mtimeMs),
      Math.min(Math.max(Math.floor(thumbnailPercent), 1), 99),
      now,
      options.force ? 1 : 0,
    );
  return Number(result.changes) > 0;
}

export function reconcileMediaPreparationJobs(thumbnailPercent: number, now = Date.now()): number {
  const db = getDb();
  const percent = Math.min(Math.max(Math.floor(thumbnailPercent), 1), 99);
  const timestamp = Math.floor(now);
  const result = db
    .prepare(
      `INSERT INTO media_prepare_jobs (
         media_id, source_version, thumbnail_percent, status, attempts, next_run_at,
         locked_until, last_error, updated_at
       )
       SELECT id, CAST(mtime_ms AS INTEGER), ?, 'pending', 0, ?, NULL, '', CURRENT_TIMESTAMP
       FROM media_assets
       WHERE (
         kind = 'audio'
         AND (duration_seconds IS NULL OR duration_seconds <= 0)
       ) OR (
         kind = 'video'
         AND playback_format <> 'hls'
         AND playback_status <> 'processing'
         AND (
           duration_seconds IS NULL OR duration_seconds <= 0
           OR thumbnail_version <> CAST(mtime_ms AS INTEGER) * 100 + ?
         )
       )
       ON CONFLICT(media_id) DO UPDATE SET
         source_version = excluded.source_version,
         thumbnail_percent = excluded.thumbnail_percent,
         status = 'pending',
         attempts = 0,
         next_run_at = excluded.next_run_at,
         locked_until = NULL,
         last_error = '',
         updated_at = CURRENT_TIMESTAMP
       WHERE media_prepare_jobs.source_version <> excluded.source_version
          OR media_prepare_jobs.thumbnail_percent <> excluded.thumbnail_percent`,
    )
    .run(percent, timestamp, percent);

  db.prepare(
    `DELETE FROM media_prepare_jobs
     WHERE media_id IN (
       SELECT jobs.media_id
       FROM media_prepare_jobs jobs
       LEFT JOIN media_assets assets ON assets.id = jobs.media_id
       WHERE assets.id IS NULL OR (
         assets.kind = 'video' AND (assets.playback_format = 'hls' OR assets.playback_status = 'processing')
       ) OR (
         (assets.kind = 'file' OR (assets.duration_seconds IS NOT NULL AND assets.duration_seconds > 0))
         AND (
           assets.kind <> 'video'
           OR assets.playback_format = 'hls'
           OR assets.thumbnail_version = CAST(assets.mtime_ms AS INTEGER) * 100 + jobs.thumbnail_percent
         )
       )
     )`,
  ).run();
  return Number(result.changes);
}

export function claimMediaPreparationJob(now = Date.now()): MediaPreparationJob | null {
  const db = getDb();
  const timestamp = Math.floor(now);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT *
         FROM media_prepare_jobs
         WHERE (status = 'pending' AND next_run_at <= ?)
            OR (status = 'processing' AND COALESCE(locked_until, 0) <= ?)
         ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, next_run_at ASC, media_id ASC
         LIMIT 1`,
      )
      .get(timestamp, timestamp) as MediaPreparationJobRow | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    db.prepare(
      `UPDATE media_prepare_jobs
       SET status = 'processing', locked_until = ?, updated_at = CURRENT_TIMESTAMP
       WHERE media_id = ?`,
    ).run(timestamp + PREPARATION_LOCK_MS, row.media_id);
    db.exec("COMMIT");
    return {
      ...toJob(row),
      status: "processing",
      lockedUntil: timestamp + PREPARATION_LOCK_MS,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function completeMediaPreparationJob(job: Pick<MediaPreparationJob, "mediaId" | "sourceVersion">): boolean {
  return getDb()
    .prepare("DELETE FROM media_prepare_jobs WHERE media_id = ? AND source_version = ?")
    .run(job.mediaId, job.sourceVersion).changes > 0;
}

export function failMediaPreparationJob(
  job: Pick<MediaPreparationJob, "mediaId" | "sourceVersion" | "attempts">,
  error: unknown,
  now = Date.now(),
): MediaPreparationJobStatus {
  const attempts = job.attempts + 1;
  const retryDelay = RETRY_DELAYS_MS[attempts - 1];
  const status: MediaPreparationJobStatus = retryDelay === undefined ? "failed" : "pending";
  const message = (error instanceof Error ? error.message : "媒体准备失败")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
  getDb()
    .prepare(
      `UPDATE media_prepare_jobs
       SET status = ?, attempts = ?, next_run_at = ?, locked_until = NULL,
           last_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE media_id = ? AND source_version = ?`,
    )
    .run(
      status,
      attempts,
      status === "pending" ? Math.floor(now + retryDelay!) : 0,
      message,
      job.mediaId,
      job.sourceVersion,
    );
  return status;
}

export function getMediaPreparationJob(mediaId: number): MediaPreparationJob | null {
  const row = getDb()
    .prepare("SELECT * FROM media_prepare_jobs WHERE media_id = ?")
    .get(mediaId) as MediaPreparationJobRow | undefined;
  return row ? toJob(row) : null;
}
