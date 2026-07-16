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
import { ensureMediaThumbnail } from "./media-thumbnail";

type MediaMaintenanceGlobal = typeof globalThis & {
  mediaMaintenanceStarted?: boolean;
  mediaMaintenanceTimer?: ReturnType<typeof setInterval>;
};

function firstThumbnailOptions() {
  const settings = getVideoThumbnailSettings();
  if (settings.mode === "carousel") {
    return {
      fraction: 1 / (settings.carouselFrames + 1),
      cacheKey: `carousel-${settings.carouselFrames}-0`,
    };
  }
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

export async function initializeMediaLibraryMaintenance() {
  const state = globalThis as MediaMaintenanceGlobal;
  if (state.mediaMaintenanceStarted) {
    return;
  }
  state.mediaMaintenanceStarted = true;
  try {
    await runMediaLibraryMaintenance(true);
  } catch (error) {
    console.error("[media] initial library sync failed", error);
  }

  state.mediaMaintenanceTimer = setInterval(() => {
    void runMediaLibraryMaintenance().catch((error) => {
      console.error("[media] scheduled library sync failed", error);
    });
  }, MEDIA_SYNC_INTERVAL_MS);
  state.mediaMaintenanceTimer.unref?.();
}
