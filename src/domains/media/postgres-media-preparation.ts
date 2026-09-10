import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { getMediaDir, getVideoThumbnailSettings } from "@/lib/config";
import { ensureMediaDuration } from "@/lib/media-metadata";
import {
  packageRemoteMediaPlayback,
  prepareRemoteMediaThumbnail,
  pruneRemoteMediaPlaybackVersions,
} from "@/lib/media-node-client";
import { ensureMediaThumbnail } from "@/lib/media-thumbnail";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "@/lib/media-storage-config";
import { getVideoPlaybackMode } from "@/lib/video-playback-mode";
import {
  cleanupRetiredPlaybackHlsVersions,
  mediaPlaybackSourceVersion,
  packageVideoHls,
  prunePlaybackHlsVersions,
} from "@/lib/video-hls";
import { mediaThumbnailVersion, type MediaAsset } from "./media-model";
import {
  savePostgresMediaThumbnailVersion,
} from "./postgres-media-admin";
import { getPostgresMediaAsset } from "./postgres-media-catalog";
import { syncPostgresMediaLibrary, type PostgresMediaSyncResult } from "./postgres-media-sync";

export type PostgresMediaPreparationStatus = "pending" | "processing" | "failed";
export type PostgresMediaPreparationJob = Readonly<{
  mediaId: number;
  sourceVersion: number;
  thumbnailPercent: number;
  status: PostgresMediaPreparationStatus;
  attempts: number;
  nextRunAt: string;
  lockedUntil: string | null;
  lastError: string;
}>;

type PreparationStatus = PostgresMediaPreparationStatus;
type PreparationJob = {
  mediaId: number;
  sourceVersion: number;
  thumbnailPercent: number;
  attempts: number;
};
type PlaybackJob = { mediaId: number; sourceVersion: string; storageNodeId: string };
type PreparationGlobal = typeof globalThis & {
  postgresMediaPreparationStarted?: boolean;
  postgresMediaPreparationActive?: number;
  postgresMediaPreparationDraining?: boolean;
  postgresMediaPlaybackActive?: number;
  postgresMediaPlaybackDraining?: boolean;
  postgresMediaMaintenanceTimer?: ReturnType<typeof setInterval>;
  postgresMediaPreparationTimer?: ReturnType<typeof setInterval>;
};

const PREPARATION_LOCK_MS = 5 * 60_000;
const PLAYBACK_STALE_MS = 5 * 60_000;
const PREPARATION_CONCURRENCY = 2;
const PLAYBACK_CONCURRENCY = 2;
const POLL_MS = 10_000;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000, 30 * 60_000, 6 * 60 * 60_000] as const;

type PreparationJobRow = QueryResultRow & {
  media_id: string | number;
  source_version: string | number;
  thumbnail_percent: string | number;
  status: string;
  attempts: string | number;
  next_run_at: Date | string;
  locked_until: Date | string | null;
  last_error: string;
};

function positiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function nonNegativeInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function errorMessage(error: unknown, fallback: string): string {
  return (error instanceof Error ? error.message : fallback)
    .normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 500);
}

function thumbnailPercent(): number {
  return Math.min(Math.max(Math.floor(getVideoThumbnailSettings().singlePercent), 1), 99);
}

export function postgresMediaAssetNeedsPreparation(asset: MediaAsset, percent: number): boolean {
  if (asset.kind === "video" && (asset.playbackFormat === "hls" || asset.playbackStatus === "processing")) return false;
  const durationReady = asset.kind === "file" || Boolean(asset.durationSeconds && asset.durationSeconds > 0);
  const thumbnailReady = asset.kind !== "video" || asset.thumbnailVersion === mediaThumbnailVersion(asset.mtimeMs, percent);
  return !durationReady || !thumbnailReady;
}

function preparationTimestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return date.toISOString();
}

export async function getPostgresMediaPreparationJob(
  executor: SqlExecutor,
  mediaId: number,
): Promise<PostgresMediaPreparationJob | null> {
  if (!Number.isSafeInteger(mediaId) || mediaId < 1) return null;
  const result = await executor.query<PreparationJobRow>({
    name: "media-preparation-job-read-v1",
    text: `SELECT media_id, source_version, thumbnail_percent, status, attempts,
        next_run_at, locked_until, last_error
      FROM media_prepare_jobs WHERE media_id = $1`,
    values: [mediaId],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (row.status !== "pending" && row.status !== "processing" && row.status !== "failed") {
    throw new Error("Invalid PostgreSQL media preparation status");
  }
  return {
    mediaId: positiveInteger(row.media_id, "media preparation id"),
    sourceVersion: nonNegativeInteger(row.source_version, "media preparation source version"),
    thumbnailPercent: positiveInteger(row.thumbnail_percent, "media preparation thumbnail percent"),
    status: row.status,
    attempts: nonNegativeInteger(row.attempts, "media preparation attempts"),
    nextRunAt: preparationTimestamp(row.next_run_at, "media preparation next run")!,
    lockedUntil: preparationTimestamp(row.locked_until, "media preparation lock"),
    lastError: row.last_error,
  };
}

async function enqueuePreparationAssets(
  assets: readonly MediaAsset[],
  percent: number,
  force: boolean,
): Promise<number> {
  const pending = assets.filter((asset) => postgresMediaAssetNeedsPreparation(asset, percent));
  const completeIds = assets.filter((asset) => !postgresMediaAssetNeedsPreparation(asset, percent)).map((asset) => asset.id);
  const executor = database("jobs");
  if (completeIds.length) {
    await executor.query({ text: "DELETE FROM media_prepare_jobs WHERE media_id = ANY($1::bigint[])", values: [completeIds] });
  }
  if (!pending.length) return 0;
  const result = await executor.query({
    text: `WITH input AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS value("mediaId" bigint, "sourceVersion" bigint)
      ) INSERT INTO media_prepare_jobs (
        media_id, source_version, thumbnail_percent, status, attempts, next_run_at, locked_until, last_error)
      SELECT "mediaId", "sourceVersion", $2, 'pending', 0, clock_timestamp(), NULL, '' FROM input
      ON CONFLICT (media_id) DO UPDATE SET
        source_version = EXCLUDED.source_version, thumbnail_percent = EXCLUDED.thumbnail_percent,
        status = 'pending', attempts = 0, next_run_at = EXCLUDED.next_run_at,
        locked_until = NULL, last_error = '', updated_at = clock_timestamp()
      WHERE media_prepare_jobs.source_version <> EXCLUDED.source_version
        OR media_prepare_jobs.thumbnail_percent <> EXCLUDED.thumbnail_percent OR $3`,
    values: [JSON.stringify(pending.map((asset) => ({ mediaId: asset.id, sourceVersion: Math.floor(asset.mtimeMs) }))), percent, force],
  });
  return result.rowCount ?? 0;
}

async function reconcilePreparationJobs(percent: number): Promise<number> {
  return withTransaction(async (tx) => {
    const result = await tx.query({
      text: `INSERT INTO media_prepare_jobs (
          media_id, source_version, thumbnail_percent, status, attempts, next_run_at, locked_until, last_error)
        SELECT id, mtime_ms, $1::integer, 'pending', 0, clock_timestamp(), NULL, ''
        FROM media_assets
        WHERE (kind = 'audio' AND (duration_seconds IS NULL OR duration_seconds <= 0))
          OR (kind = 'video' AND playback_format <> 'hls' AND playback_status <> 'processing' AND (
            duration_seconds IS NULL OR duration_seconds <= 0 OR thumbnail_version <> mtime_ms * 101 + $1::integer))
        ON CONFLICT (media_id) DO UPDATE SET
          source_version = EXCLUDED.source_version, thumbnail_percent = EXCLUDED.thumbnail_percent,
          status = 'pending', attempts = 0, next_run_at = EXCLUDED.next_run_at,
          locked_until = NULL, last_error = '', updated_at = clock_timestamp()
        WHERE media_prepare_jobs.source_version <> EXCLUDED.source_version
          OR media_prepare_jobs.thumbnail_percent <> EXCLUDED.thumbnail_percent`,
      values: [percent],
    });
    await tx.query({
      text: `DELETE FROM media_prepare_jobs job
        WHERE NOT EXISTS (SELECT 1 FROM media_assets asset WHERE asset.id = job.media_id)
          OR EXISTS (
            SELECT 1 FROM media_assets asset WHERE asset.id = job.media_id AND (
              asset.kind = 'video' AND (asset.playback_format = 'hls' OR asset.playback_status = 'processing')
              OR ((asset.kind = 'file' OR COALESCE(asset.duration_seconds, 0) > 0)
                AND (asset.kind <> 'video' OR asset.thumbnail_version = asset.mtime_ms * 101 + job.thumbnail_percent))
            )
          )`,
    });
    return result.rowCount ?? 0;
  }, { role: "jobs" });
}

async function claimPreparationJob(): Promise<PreparationJob | null> {
  return withTransaction(async (tx) => {
    const result = await tx.query<{
      media_id: string | number; source_version: string | number; thumbnail_percent: number; attempts: number;
    }>({
      text: `WITH candidate AS (
          SELECT media_id FROM media_prepare_jobs
          WHERE (status = 'pending' AND next_run_at <= clock_timestamp())
            OR (status = 'processing' AND COALESCE(locked_until, '-infinity'::timestamptz) <= clock_timestamp())
          ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, next_run_at, media_id
          FOR UPDATE SKIP LOCKED LIMIT 1
        ) UPDATE media_prepare_jobs job
        SET status = 'processing', locked_until = clock_timestamp() + ($1::integer * interval '1 millisecond'),
          updated_at = clock_timestamp()
        FROM candidate WHERE job.media_id = candidate.media_id
        RETURNING job.media_id, job.source_version, job.thumbnail_percent, job.attempts`,
      values: [PREPARATION_LOCK_MS],
    });
    const row = result.rows[0];
    return row ? {
      mediaId: positiveInteger(row.media_id, "media id"),
      sourceVersion: nonNegativeInteger(row.source_version, "media source version"),
      thumbnailPercent: row.thumbnail_percent,
      attempts: row.attempts,
    } : null;
  }, { role: "jobs" });
}

async function completePreparationJob(job: PreparationJob): Promise<void> {
  await database("jobs").query({
    text: "DELETE FROM media_prepare_jobs WHERE media_id = $1 AND source_version = $2",
    values: [job.mediaId, job.sourceVersion],
  });
}

async function failPreparationJob(job: PreparationJob, error: unknown): Promise<PreparationStatus> {
  const attempts = job.attempts + 1;
  const retryDelay = RETRY_DELAYS_MS[attempts - 1];
  const status: PreparationStatus = retryDelay === undefined ? "failed" : "pending";
  await database("jobs").query({
    text: `UPDATE media_prepare_jobs SET status = $3, attempts = $4,
      next_run_at = CASE WHEN $3 = 'pending' THEN clock_timestamp() + ($5::integer * interval '1 millisecond') ELSE next_run_at END,
      locked_until = NULL, last_error = $6, updated_at = clock_timestamp()
      WHERE media_id = $1 AND source_version = $2`,
    values: [job.mediaId, job.sourceVersion, status, attempts, retryDelay || 0, errorMessage(error, "媒体准备失败")],
  });
  return status;
}

async function prepareAsset(job: PreparationJob): Promise<void> {
  const executor = database("jobs");
  const asset = await getPostgresMediaAsset(executor, job.mediaId);
  if (!asset || Math.floor(asset.mtimeMs) !== job.sourceVersion ||
      !postgresMediaAssetNeedsPreparation(asset, job.thumbnailPercent)) {
    await completePreparationJob(job);
    return;
  }
  try {
    const durationSeconds = await ensureMediaDuration(asset);
    if (asset.kind === "video") {
      const expectedVersion = mediaThumbnailVersion(asset.mtimeMs, job.thumbnailPercent);
      if (asset.thumbnailVersion !== expectedVersion) {
        if (isRemoteMediaStorage()) {
          const ready = await prepareRemoteMediaThumbnail({
            ...asset,
            storageNodeId: resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id,
            durationSeconds,
          }, job.thumbnailPercent);
          if (!ready) throw new Error("媒体节点未完成视频封面准备");
        } else {
          await ensureMediaThumbnail(
            { ...asset, durationSeconds },
            { fraction: job.thumbnailPercent / 100, cacheKey: `single-${job.thumbnailPercent}` },
          );
        }
        if (!await savePostgresMediaThumbnailVersion(executor, asset.id, expectedVersion)) {
          throw new Error("媒体文件在封面生成期间发生变化");
        }
      }
    }
    await completePreparationJob(job);
  } catch (error) {
    const status = await failPreparationJob(job, error);
    console.warn(`[media] PostgreSQL asset preparation ${status === "failed" ? "failed permanently" : "will retry"}`, asset.id, error);
  }
}

async function drainPreparationJobs(): Promise<void> {
  const state = globalThis as PreparationGlobal;
  if (state.postgresMediaPreparationDraining) return;
  state.postgresMediaPreparationDraining = true;
  state.postgresMediaPreparationActive ||= 0;
  try {
    while (state.postgresMediaPreparationActive < PREPARATION_CONCURRENCY) {
      const job = await claimPreparationJob();
      if (!job) break;
      state.postgresMediaPreparationActive += 1;
      void prepareAsset(job).finally(() => {
        state.postgresMediaPreparationActive = Math.max(0, (state.postgresMediaPreparationActive || 1) - 1);
        void drainPreparationJobs();
      });
    }
  } finally {
    state.postgresMediaPreparationDraining = false;
  }
}

function playbackNodeId(asset: MediaAsset): string {
  return isRemoteMediaStorage() ? resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id : "";
}

export async function schedulePostgresMediaPlaybackPreparation(
  asset: MediaAsset,
  options: { force?: boolean } = {},
): Promise<boolean> {
  if (asset.kind !== "video") return false;
  const sourceVersion = mediaPlaybackSourceVersion(asset.mtimeMs, asset.sizeBytes);
  if (!options.force && asset.playbackFormat === "hls" && asset.playbackVersion === sourceVersion && asset.playbackManifestPath) {
    return false;
  }
  const changed = await withTransaction(async (tx) => {
    const result = await tx.query({
      text: `INSERT INTO media_playback_jobs (media_id, source_version, storage_node_id, status, attempts, last_error)
        VALUES ($1, $2, $3, 'pending', 0, '')
        ON CONFLICT (media_id) DO UPDATE SET source_version = EXCLUDED.source_version,
          storage_node_id = EXCLUDED.storage_node_id, status = 'pending',
          attempts = CASE WHEN media_playback_jobs.source_version = EXCLUDED.source_version THEN media_playback_jobs.attempts ELSE 0 END,
          last_error = '', updated_at = clock_timestamp()
        WHERE media_playback_jobs.status <> 'processing'
          OR media_playback_jobs.source_version <> EXCLUDED.source_version OR $4`,
      values: [asset.id, sourceVersion, playbackNodeId(asset), options.force === true],
    });
    if (!result.rowCount) return false;
    await tx.query({
      text: "UPDATE media_assets SET playback_status = 'pending', playback_error = '', updated_at = clock_timestamp() WHERE id = $1",
      values: [asset.id],
    });
    return true;
  }, { role: "jobs" });
  if (changed) void drainPlaybackJobs();
  return changed;
}

async function recoverStalePlaybackJobs(): Promise<number> {
  return withTransaction(async (tx) => {
    const result = await tx.query({
      text: `UPDATE media_playback_jobs SET status = 'pending', last_error = '', updated_at = clock_timestamp()
        WHERE status = 'processing' AND updated_at < clock_timestamp() - ($1::integer * interval '1 millisecond')`,
      values: [PLAYBACK_STALE_MS],
    });
    if (result.rowCount) {
      await tx.query({
        text: `UPDATE media_assets SET playback_status = 'pending', playback_error = '', updated_at = clock_timestamp()
          WHERE id IN (SELECT media_id FROM media_playback_jobs WHERE status = 'pending')`,
      });
    }
    return result.rowCount ?? 0;
  }, { role: "jobs" });
}

async function claimPlaybackJob(): Promise<PlaybackJob | null> {
  try {
    return await withTransaction(async (tx) => {
      const result = await tx.query<{
        media_id: string | number; source_version: string; storage_node_id: string;
      }>({
        text: `WITH candidate AS (
            SELECT job.media_id FROM media_playback_jobs job
            WHERE job.status = 'pending' AND NOT EXISTS (
              SELECT 1 FROM media_playback_jobs active
              WHERE active.storage_node_id = job.storage_node_id AND active.status = 'processing')
            ORDER BY job.updated_at, job.media_id FOR UPDATE SKIP LOCKED LIMIT 1
          ) UPDATE media_playback_jobs job SET status = 'processing', attempts = attempts + 1,
            last_error = '', updated_at = clock_timestamp()
          FROM candidate WHERE job.media_id = candidate.media_id
          RETURNING job.media_id, job.source_version, job.storage_node_id`,
      });
      const row = result.rows[0];
      if (!row) return null;
      await tx.query({
        text: "UPDATE media_assets SET playback_status = 'processing', playback_error = '', updated_at = clock_timestamp() WHERE id = $1",
        values: [row.media_id],
      });
      return {
        mediaId: positiveInteger(row.media_id, "media id"),
        sourceVersion: row.source_version,
        storageNodeId: row.storage_node_id,
      };
    }, { role: "jobs" });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") return null;
    throw error;
  }
}

async function refreshPlaybackJob(job: PlaybackJob): Promise<void> {
  await database("jobs").query({
    text: `UPDATE media_playback_jobs SET updated_at = clock_timestamp()
      WHERE media_id = $1 AND source_version = $2 AND status = 'processing'`,
    values: [job.mediaId, job.sourceVersion],
  });
}

async function publishPlayback(job: PlaybackJob, manifestPath: string): Promise<boolean> {
  return withTransaction(async (tx) => {
    const published = await tx.query({
      text: `UPDATE media_assets SET playback_format = 'hls', playback_version = $2,
        playback_manifest_path = $3, playback_status = 'ready', playback_error = '',
        playback_published_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1 AND kind = 'video' AND mtime_ms::text || '-' || size_bytes::text = $2
          AND EXISTS (SELECT 1 FROM media_playback_jobs
            WHERE media_id = $1 AND source_version = $2 AND status = 'processing')`,
      values: [job.mediaId, job.sourceVersion, manifestPath],
    });
    if (published.rowCount !== 1) return false;
    const removed = await tx.query({
      text: `DELETE FROM media_playback_jobs
        WHERE media_id = $1 AND source_version = $2 AND status = 'processing'`,
      values: [job.mediaId, job.sourceVersion],
    });
    return removed.rowCount === 1;
  }, { role: "jobs" });
}

async function failPlayback(job: PlaybackJob, error: unknown): Promise<void> {
  const message = errorMessage(error, "HLS 播放准备失败");
  await withTransaction(async (tx) => {
    const failed = await tx.query({
      text: `UPDATE media_playback_jobs SET status = 'failed', last_error = $3, updated_at = clock_timestamp()
        WHERE media_id = $1 AND source_version = $2 AND status = 'processing'`,
      values: [job.mediaId, job.sourceVersion, message],
    });
    if (failed.rowCount) {
      await tx.query({
        text: `UPDATE media_assets SET playback_status = CASE
            WHEN playback_format = 'hls' AND playback_manifest_path IS NOT NULL AND playback_version <> '' THEN 'ready'
            ELSE 'failed' END,
          playback_error = $2, updated_at = clock_timestamp() WHERE id = $1`,
        values: [job.mediaId, message],
      });
    }
  }, { role: "jobs" });
}

async function preparePlayback(job: PlaybackJob): Promise<void> {
  const asset = await getPostgresMediaAsset(database("jobs"), job.mediaId);
  if (!asset || asset.kind !== "video" || mediaPlaybackSourceVersion(asset.mtimeMs, asset.sizeBytes) !== job.sourceVersion) {
    await database("jobs").query({ text: "DELETE FROM media_playback_jobs WHERE media_id = $1", values: [job.mediaId] });
    return;
  }
  const heartbeat = setInterval(() => void refreshPlaybackJob(job).catch((error) => {
    console.warn(`[media] PostgreSQL HLS heartbeat failed for ${job.mediaId}`, error);
  }), 60_000);
  heartbeat.unref?.();
  try {
    const result = isRemoteMediaStorage()
      ? await packageRemoteMediaPlayback({
          storageNodeId: job.storageNodeId,
          id: asset.id,
          storedName: asset.storedName,
          mtimeMs: asset.mtimeMs,
          sizeBytes: asset.sizeBytes,
        })
      : await packageVideoHls({
          root: getMediaDir(), mediaId: asset.id, storedName: asset.storedName,
          mtimeMs: asset.mtimeMs, sizeBytes: asset.sizeBytes,
        });
    if (result.version !== job.sourceVersion || !await publishPlayback(job, result.manifestPath)) {
      throw new Error("视频文件在 HLS 准备期间发生变化");
    }
    if (job.storageNodeId) {
      await pruneRemoteMediaPlaybackVersions(job.storageNodeId, asset.id, job.sourceVersion).catch((error) => {
        console.warn(`[media] published HLS ${asset.id}, but old remote versions were not retired`, error);
      });
    } else {
      prunePlaybackHlsVersions(getMediaDir(), asset.id, job.sourceVersion);
    }
  } catch (error) {
    await failPlayback(job, error);
    console.warn(`[media] PostgreSQL HLS preparation failed for ${job.mediaId}`, error);
  } finally {
    clearInterval(heartbeat);
  }
}

async function drainPlaybackJobs(): Promise<void> {
  const state = globalThis as PreparationGlobal;
  if (state.postgresMediaPlaybackDraining) return;
  state.postgresMediaPlaybackDraining = true;
  state.postgresMediaPlaybackActive ||= 0;
  try {
    while (state.postgresMediaPlaybackActive < PLAYBACK_CONCURRENCY) {
      const job = await claimPlaybackJob();
      if (!job) break;
      state.postgresMediaPlaybackActive += 1;
      void preparePlayback(job).finally(() => {
        state.postgresMediaPlaybackActive = Math.max(0, (state.postgresMediaPlaybackActive || 1) - 1);
        void drainPlaybackJobs();
      });
    }
  } finally {
    state.postgresMediaPlaybackDraining = false;
  }
}

export async function schedulePostgresMediaPreparation(
  assets: readonly MediaAsset[],
  options: { force?: boolean } = {},
): Promise<number> {
  const scheduled = await enqueuePreparationAssets(assets, thumbnailPercent(), options.force === true);
  if (scheduled) void drainPreparationJobs();
  return scheduled;
}

export async function scheduleMissingPostgresMediaPreparation(): Promise<void> {
  await Promise.all([reconcilePreparationJobs(thumbnailPercent()), recoverStalePlaybackJobs()]);
  void drainPreparationJobs();
  void drainPlaybackJobs();
}

export async function runPostgresMediaLibraryMaintenance(force = false): Promise<PostgresMediaSyncResult> {
  const result = await syncPostgresMediaLibrary({ force });
  await scheduleMissingPostgresMediaPreparation();
  return result;
}

export async function initializePostgresMediaLibraryMaintenance(): Promise<void> {
  const state = globalThis as PreparationGlobal;
  if (state.postgresMediaPreparationStarted) return;
  state.postgresMediaPreparationStarted = true;
  await scheduleMissingPostgresMediaPreparation();
  const initial = setTimeout(() => void runPostgresMediaLibraryMaintenance(true).catch((error) => {
    console.error("[media] initial PostgreSQL library sync failed", error);
  }), 1_500);
  initial.unref?.();
  state.postgresMediaMaintenanceTimer = setInterval(() => {
    void runPostgresMediaLibraryMaintenance().catch((error) => console.error("[media] scheduled PostgreSQL library sync failed", error));
  }, 30 * 60_000);
  state.postgresMediaMaintenanceTimer.unref?.();
  state.postgresMediaPreparationTimer = setInterval(() => {
    void scheduleMissingPostgresMediaPreparation().catch((error) => console.error("[media] PostgreSQL preparation poll failed", error));
  }, POLL_MS);
  state.postgresMediaPreparationTimer.unref?.();
  if (!isRemoteMediaStorage()) cleanupRetiredPlaybackHlsVersions(getMediaDir());
  if (getVideoPlaybackMode() === "mp4") {
    await database("jobs").query({ text: "DELETE FROM media_playback_jobs WHERE status = 'pending'" });
  }
}
