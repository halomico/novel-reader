import { getVideoThumbnailSettings } from "./config";
import {
  listMediaAssetsNeedingPreparation,
  mediaThumbnailVersion,
  MEDIA_SYNC_INTERVAL_MS,
  saveMediaThumbnailVersion,
  syncMediaLibrary,
  type MediaAsset,
  type MediaSyncResult,
} from "./media";
import { ensureMediaDuration } from "./media-metadata";
import { prepareRemoteMediaThumbnail } from "./media-node-client";
import { ensureMediaThumbnail } from "./media-thumbnail";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";

type MediaMaintenanceGlobal = typeof globalThis & {
  mediaMaintenanceStarted?: boolean;
  mediaMaintenanceTimer?: ReturnType<typeof setInterval>;
  mediaPreparationQueue?: MediaAsset[];
  mediaPreparationKeys?: Set<string>;
  mediaPreparationActive?: number;
};

const MEDIA_PREPARATION_CONCURRENCY = 2;

function firstThumbnailOptions() {
  const settings = getVideoThumbnailSettings();
  return {
    fraction: settings.singlePercent / 100,
    cacheKey: `single-${settings.singlePercent}`,
  };
}

async function prepareMediaAsset(asset: MediaAsset) {
  if (asset.kind === "file") return;
  const durationSeconds = await ensureMediaDuration(asset);
  const thumbnailOptions = firstThumbnailOptions();
  const thumbnailPercent = Math.round(thumbnailOptions.fraction * 100);
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
    await ensureMediaThumbnail({ ...asset, durationSeconds }, thumbnailOptions);
  }
  saveMediaThumbnailVersion(asset.id, expectedThumbnailVersion);
}

function runNextMediaPreparationJobs() {
  const state = globalThis as MediaMaintenanceGlobal;
  state.mediaPreparationQueue ||= [];
  state.mediaPreparationKeys ||= new Set<string>();
  state.mediaPreparationActive ||= 0;
  while (
    state.mediaPreparationActive < MEDIA_PREPARATION_CONCURRENCY &&
    state.mediaPreparationQueue.length
  ) {
    const asset = state.mediaPreparationQueue.shift()!;
    const key = `${asset.id}:${Math.floor(asset.mtimeMs)}`;
    state.mediaPreparationActive += 1;
    void prepareMediaAsset(asset)
      .catch((error) => {
        console.warn("[media] asset preparation failed", asset.id, error);
      })
      .finally(() => {
        state.mediaPreparationKeys!.delete(key);
        state.mediaPreparationActive = Math.max(0, (state.mediaPreparationActive || 1) - 1);
        runNextMediaPreparationJobs();
      });
  }
}

export function scheduleMediaPreparation(assets: MediaAsset[]) {
  const state = globalThis as MediaMaintenanceGlobal;
  const thumbnailPercent = Math.round(firstThumbnailOptions().fraction * 100);
  state.mediaPreparationQueue ||= [];
  state.mediaPreparationKeys ||= new Set<string>();
  for (const asset of assets) {
    const readyDuration = asset.kind === "file" || Boolean(asset.durationSeconds && asset.durationSeconds > 0);
    const readyThumbnail =
      asset.kind !== "video" ||
      asset.thumbnailVersion === mediaThumbnailVersion(asset.mtimeMs, thumbnailPercent);
    if (readyDuration && readyThumbnail) continue;
    const key = `${asset.id}:${Math.floor(asset.mtimeMs)}`;
    if (state.mediaPreparationKeys.has(key)) continue;
    state.mediaPreparationKeys.add(key);
    state.mediaPreparationQueue.push(asset);
  }
  runNextMediaPreparationJobs();
}

export function scheduleMissingMediaPreparation() {
  const thumbnailPercent = Math.round(firstThumbnailOptions().fraction * 100);
  scheduleMediaPreparation(listMediaAssetsNeedingPreparation(1_000, thumbnailPercent));
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
