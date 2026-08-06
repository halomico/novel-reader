import { getMediaDir as getConfiguredMediaDir, getVideoThumbnailSettings } from "./config";
import {
  getMediaAsset,
  mediaThumbnailVersion,
  MEDIA_SYNC_INTERVAL_MS,
  saveMediaThumbnailVersion,
  syncMediaLibrary,
  type MediaAsset,
  type MediaSyncResult,
} from "./media";
import { ensureMediaDuration } from "./media-metadata";
import { prepareRemoteMediaThumbnail } from "./media-node-client";
import {
  claimMediaPreparationJob,
  completeMediaPreparationJob,
  enqueueMediaPreparationJob,
  failMediaPreparationJob,
  mediaAssetNeedsPreparation,
  reconcileMediaPreparationJobs,
  type MediaPreparationJob,
} from "./media-preparation-jobs";
import { ensureMediaThumbnail } from "./media-thumbnail";
import { resumePendingMediaPlaybackPreparation } from "./media-playback-preparation";
import { cleanupRetiredPlaybackHlsVersions } from "./video-hls";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";

type MediaMaintenanceGlobal = typeof globalThis & {
  mediaMaintenanceStarted?: boolean;
  mediaMaintenanceTimer?: ReturnType<typeof setInterval>;
  mediaPreparationTimer?: ReturnType<typeof setInterval>;
  mediaPreparationActive?: number;
};

const MEDIA_PREPARATION_CONCURRENCY = 2;
const MEDIA_PREPARATION_POLL_MS = 10_000;

function thumbnailOptions(percent = getVideoThumbnailSettings().singlePercent) {
  return {
    fraction: percent / 100,
    cacheKey: `single-${percent}`,
  };
}

async function prepareMediaAsset(asset: MediaAsset, thumbnailPercent: number) {
  if (asset.kind === "file") return;
  const durationSeconds = await ensureMediaDuration(asset);
  const options = thumbnailOptions(thumbnailPercent);
  const expectedThumbnailVersion = mediaThumbnailVersion(asset.mtimeMs, thumbnailPercent);
  if (asset.kind !== "video" || asset.thumbnailVersion === expectedThumbnailVersion) {
    return;
  }
  if (isRemoteMediaStorage()) {
    const ready = await prepareRemoteMediaThumbnail({
      ...asset,
      storageNodeId: resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id,
      durationSeconds,
    }, thumbnailPercent);
    if (!ready) throw new Error("媒体节点未完成视频封面准备");
  } else {
    await ensureMediaThumbnail({ ...asset, durationSeconds }, options);
  }
  saveMediaThumbnailVersion(asset.id, expectedThumbnailVersion);
}

async function processMediaPreparationJob(job: MediaPreparationJob) {
  const asset = getMediaAsset(job.mediaId);
  if (!asset) {
    completeMediaPreparationJob(job);
    return;
  }
  if (
    Math.floor(asset.mtimeMs) !== job.sourceVersion ||
    !mediaAssetNeedsPreparation(asset, job.thumbnailPercent)
  ) {
    completeMediaPreparationJob(job);
    if (mediaAssetNeedsPreparation(asset, getVideoThumbnailSettings().singlePercent)) {
      enqueueMediaPreparationJob(asset, getVideoThumbnailSettings().singlePercent);
    }
    return;
  }
  try {
    await prepareMediaAsset(asset, job.thumbnailPercent);
    completeMediaPreparationJob(job);
  } catch (error) {
    const status = failMediaPreparationJob(job, error);
    console.warn(
      `[media] asset preparation ${status === "failed" ? "failed permanently" : "will retry"}`,
      asset.id,
      error,
    );
  }
}

function runNextMediaPreparationJobs() {
  const state = globalThis as MediaMaintenanceGlobal;
  state.mediaPreparationActive ||= 0;
  while (state.mediaPreparationActive < MEDIA_PREPARATION_CONCURRENCY) {
    const job = claimMediaPreparationJob();
    if (!job) break;
    state.mediaPreparationActive += 1;
    void processMediaPreparationJob(job)
      .catch((error) => {
        console.error("[media] preparation worker failed", error);
      })
      .finally(() => {
        state.mediaPreparationActive = Math.max(0, (state.mediaPreparationActive || 1) - 1);
        runNextMediaPreparationJobs();
      });
  }
}

export function scheduleMediaPreparation(assets: MediaAsset[], options: { force?: boolean } = {}) {
  const thumbnailPercent = getVideoThumbnailSettings().singlePercent;
  for (const asset of assets) {
    enqueueMediaPreparationJob(asset, thumbnailPercent, options);
  }
  runNextMediaPreparationJobs();
}

export function scheduleMissingMediaPreparation() {
  reconcileMediaPreparationJobs(getVideoThumbnailSettings().singlePercent);
  runNextMediaPreparationJobs();
  resumePendingMediaPlaybackPreparation();
}

export async function runMediaLibraryMaintenance(force = false): Promise<MediaSyncResult> {
  const result = await syncMediaLibrary({ force });
  scheduleMissingMediaPreparation();
  return result;
}

export function initializeMediaLibraryMaintenance() {
  const state = globalThis as MediaMaintenanceGlobal;
  if (state.mediaMaintenanceStarted) {
    return;
  }
  state.mediaMaintenanceStarted = true;
  runNextMediaPreparationJobs();
  resumePendingMediaPlaybackPreparation();

  const initialRun = setTimeout(() => {
    void runMediaLibraryMaintenance(true).catch((error) => {
      console.error("[media] initial library sync failed", error);
    });
    if (!isRemoteMediaStorage()) {
      cleanupRetiredPlaybackHlsVersions(getConfiguredMediaDir());
    }
  }, 1_500);
  initialRun.unref?.();

  state.mediaMaintenanceTimer = setInterval(() => {
    void runMediaLibraryMaintenance().catch((error) => {
      console.error("[media] scheduled library sync failed", error);
    });
  }, MEDIA_SYNC_INTERVAL_MS);
  state.mediaMaintenanceTimer.unref?.();

  state.mediaPreparationTimer = setInterval(() => {
    runNextMediaPreparationJobs();
    resumePendingMediaPlaybackPreparation();
  }, MEDIA_PREPARATION_POLL_MS);
  state.mediaPreparationTimer.unref?.();
}
