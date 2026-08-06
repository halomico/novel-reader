import { getMediaDir as getConfiguredMediaDir } from "./config";
import {
  getMediaAsset,
  markMediaPlaybackProcessing,
  recoverStaleMediaPlaybackPreparations,
  refreshMediaPlaybackProcessing,
  requestMediaPlaybackPreparation,
  saveMediaPlaybackFailure,
  saveMediaPlaybackReady,
  type MediaAsset,
} from "./media";
import { getDb } from "./db";
import { packageRemoteMediaPlayback, pruneRemoteMediaPlaybackVersions } from "./media-node-client";
import { isRemoteMediaStorage, resolveRemoteMediaNodeForAsset } from "./media-storage-config";
import { mediaPlaybackSourceVersion, packageVideoHls, prunePlaybackHlsVersions } from "./video-hls";

type PlaybackPreparationGlobal = typeof globalThis & {
  mediaPlaybackQueue?: number[];
  mediaPlaybackQueued?: Set<number>;
  mediaPlaybackActiveKeys?: Set<string>;
};

const PROCESSING_HEARTBEAT_MS = 60_000;
const STALE_PROCESSING_MS = 5 * 60_000;

function state(): PlaybackPreparationGlobal {
  const value = globalThis as PlaybackPreparationGlobal;
  value.mediaPlaybackQueue ||= [];
  value.mediaPlaybackQueued ||= new Set<number>();
  value.mediaPlaybackActiveKeys ||= new Set<string>();
  return value;
}

function preparationKey(asset: MediaAsset): string {
  return isRemoteMediaStorage()
    ? `node:${resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id}`
    : "local";
}

export async function prepareMediaPlaybackAsset(mediaId: number): Promise<boolean> {
  const asset = getMediaAsset(mediaId);
  if (!asset || asset.kind !== "video") return false;
  const sourceVersion = mediaPlaybackSourceVersion(asset.mtimeMs, asset.sizeBytes);
  if (!markMediaPlaybackProcessing(asset.id, sourceVersion)) return false;
  const remoteNodeId = isRemoteMediaStorage()
    ? resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id
    : null;
  const heartbeat = setInterval(
    () => refreshMediaPlaybackProcessing(asset.id, sourceVersion),
    PROCESSING_HEARTBEAT_MS,
  );
  heartbeat.unref?.();
  try {
    const result = isRemoteMediaStorage()
      ? await packageRemoteMediaPlayback({
          storageNodeId: remoteNodeId!,
          id: asset.id,
          storedName: asset.storedName,
          mtimeMs: asset.mtimeMs,
          sizeBytes: asset.sizeBytes,
        })
      : await packageVideoHls({
          root: getConfiguredMediaDir(),
          mediaId: asset.id,
          storedName: asset.storedName,
          mtimeMs: asset.mtimeMs,
          sizeBytes: asset.sizeBytes,
        });
    if (
      result.version !== sourceVersion ||
      !saveMediaPlaybackReady({
        id: asset.id,
        sourceVersion,
        manifestPath: result.manifestPath,
      })
    ) {
      throw new Error("视频文件在 HLS 准备期间发生变化");
    }
    if (remoteNodeId) {
      try {
        await pruneRemoteMediaPlaybackVersions(remoteNodeId, asset.id, sourceVersion);
      } catch (error) {
        console.warn(`[media] published HLS ${asset.id}, but old remote versions were not retired`, error);
      }
    } else {
      prunePlaybackHlsVersions(getConfiguredMediaDir(), asset.id, sourceVersion);
    }
    return true;
  } catch (error) {
    saveMediaPlaybackFailure(asset.id, sourceVersion, error);
    console.warn(`[media] HLS preparation failed for ${asset.id}`, error);
    return false;
  } finally {
    clearInterval(heartbeat);
  }
}

function runQueue() {
  const current = state();
  while (current.mediaPlaybackQueue?.length) {
    let selectedIndex = -1;
    let selectedKey = "";
    for (let index = 0; index < current.mediaPlaybackQueue.length; index += 1) {
      const asset = getMediaAsset(current.mediaPlaybackQueue[index]);
      if (!asset || asset.kind !== "video") {
        current.mediaPlaybackQueued?.delete(current.mediaPlaybackQueue[index]);
        current.mediaPlaybackQueue.splice(index, 1);
        index -= 1;
        continue;
      }
      const key = preparationKey(asset);
      if (!current.mediaPlaybackActiveKeys?.has(key)) {
        selectedIndex = index;
        selectedKey = key;
        break;
      }
    }
    if (selectedIndex < 0) return;
    const [mediaId] = current.mediaPlaybackQueue.splice(selectedIndex, 1);
    current.mediaPlaybackQueued?.delete(mediaId);
    current.mediaPlaybackActiveKeys?.add(selectedKey);
    void prepareMediaPlaybackAsset(mediaId)
      .catch((error) => console.warn(`[media] HLS worker failed for ${mediaId}`, error))
      .finally(() => {
        current.mediaPlaybackActiveKeys?.delete(selectedKey);
        runQueue();
      });
  }
}

function enqueuePlaybackPreparation(mediaId: number): boolean {
  const current = state();
  if (current.mediaPlaybackQueued?.has(mediaId)) return false;
  current.mediaPlaybackQueued?.add(mediaId);
  current.mediaPlaybackQueue?.push(mediaId);
  runQueue();
  return true;
}

export function scheduleMediaPlaybackPreparation(
  asset: MediaAsset,
  options: { force?: boolean } = {},
): boolean {
  if (!requestMediaPlaybackPreparation(asset, Boolean(options.force))) return false;
  return enqueuePlaybackPreparation(asset.id);
}

function staleBeforeTimestamp(now = Date.now()): string {
  return new Date(now - STALE_PROCESSING_MS).toISOString().replace("T", " ").replace("Z", "");
}

export function resumePendingMediaPlaybackPreparation(limit = 100): number {
  recoverStaleMediaPlaybackPreparations(staleBeforeTimestamp());
  const rows = getMediaAssetPendingIds(limit);
  let scheduled = 0;
  for (const id of rows) {
    if (enqueuePlaybackPreparation(id)) scheduled += 1;
  }
  return scheduled;
}

function getMediaAssetPendingIds(limit: number): number[] {
  return (getDb().prepare(
    `SELECT media_id AS id FROM media_playback_jobs
     WHERE status = 'pending'
     ORDER BY updated_at ASC, media_id ASC LIMIT ?`,
  ).all(Math.min(Math.max(Math.floor(limit), 1), 1_000)) as Array<{ id: number }>)
    .map((row) => row.id);
}
