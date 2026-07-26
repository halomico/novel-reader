import { getVideoThumbnailSettings } from "./config";
import {
  listMediaAssetsNeedingDuration,
  listVideoAssetsForPreparation,
  MEDIA_SYNC_INTERVAL_MS,
  syncMediaLibrary,
  type MediaAsset,
  type MediaSyncResult,
} from "./media";
import { scheduleMediaDurations } from "./media-metadata";
import { prewarmRemoteMediaThumbnail } from "./media-node-client";
import { ensureMediaThumbnail } from "./media-thumbnail";
import { isRemoteMediaStorage } from "./media-storage-config";

type MediaMaintenanceGlobal = typeof globalThis & {
  mediaMaintenanceStarted?: boolean;
  mediaMaintenanceTimer?: ReturnType<typeof setInterval>;
  mediaRemoteThumbnailWarmups?: Map<string, number>;
};

const REMOTE_THUMBNAIL_WARM_TTL_MS = 6 * 60 * 60_000;
const REMOTE_THUMBNAIL_RETRY_MS = 5 * 60_000;
const MAX_REMOTE_THUMBNAIL_WARMUPS = 2_000;

function firstThumbnailOptions() {
  const settings = getVideoThumbnailSettings();
  return {
    fraction: settings.singlePercent / 100,
    cacheKey: `single-${settings.singlePercent}`,
  };
}

export function scheduleMediaPreparation(assets: MediaAsset[]) {
  const videos = assets.filter((asset) => asset.kind === "video");
  scheduleMediaDurations(assets);
  if (!videos.length) {
    return;
  }
  const thumbnailOptions = firstThumbnailOptions();
  if (isRemoteMediaStorage()) {
    const state = globalThis as MediaMaintenanceGlobal;
    const warmups = state.mediaRemoteThumbnailWarmups || new Map<string, number>();
    state.mediaRemoteThumbnailWarmups = warmups;
    const now = Date.now();
    for (const asset of videos) {
      const key = `${asset.storedName}:${asset.mtimeMs}:${asset.sizeBytes}:${thumbnailOptions.cacheKey}`;
      if ((warmups.get(key) || 0) > now) continue;
      warmups.set(key, now + REMOTE_THUMBNAIL_RETRY_MS);
      if (warmups.size > MAX_REMOTE_THUMBNAIL_WARMUPS) {
        warmups.delete(warmups.keys().next().value!);
      }
      void prewarmRemoteMediaThumbnail(asset, Math.round(thumbnailOptions.fraction * 100))
        .then(() => warmups.set(key, Date.now() + REMOTE_THUMBNAIL_WARM_TTL_MS))
        .catch(() => warmups.set(key, Date.now() + REMOTE_THUMBNAIL_RETRY_MS));
    }
    return;
  }
  for (const asset of videos) {
    void ensureMediaThumbnail(asset, thumbnailOptions).catch(() => undefined);
  }
}

export function scheduleMissingMediaPreparation() {
  const videos = listVideoAssetsForPreparation(200);
  scheduleMediaPreparation(videos);
  scheduleMediaDurations(listMediaAssetsNeedingDuration(100));
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

  const initialRun = setTimeout(() => {
    void runMediaLibraryMaintenance(true).catch((error) => {
      console.error("[media] initial library sync failed", error);
    });
  }, 1_500);
  initialRun.unref?.();

  state.mediaMaintenanceTimer = setInterval(() => {
    void runMediaLibraryMaintenance().catch((error) => {
      console.error("[media] scheduled library sync failed", error);
    });
  }, MEDIA_SYNC_INTERVAL_MS);
  state.mediaMaintenanceTimer.unref?.();
}
