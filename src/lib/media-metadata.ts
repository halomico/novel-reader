import { database } from "@/core/db/postgres";
import type { MediaAsset } from "@/domains/media/media-model";
import { mediaFilePath } from "@/domains/media/media-storage-model";
import { savePostgresMediaDuration } from "@/domains/media/postgres-media-admin";
import { probeRemoteMediaDuration } from "./media-node-client";
import { probeMediaDurationFile } from "./media-processing";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";

type MediaMetadataGlobal = typeof globalThis & {
  mediaDurationJobs?: Map<string, Promise<number>>;
  mediaDurationQueue?: Promise<void>;
};

export function ensureMediaDuration(asset: MediaAsset): Promise<number> {
  if (asset.durationSeconds && asset.durationSeconds > 0) {
    return Promise.resolve(asset.durationSeconds);
  }
  if (asset.kind === "file") {
    return Promise.reject(new Error("文件资源没有播放时长"));
  }

  const state = globalThis as MediaMetadataGlobal;
  const jobs = state.mediaDurationJobs || new Map<string, Promise<number>>();
  state.mediaDurationJobs = jobs;
  const key = `${asset.id}:${asset.mtimeMs}`;
  const existing = jobs.get(key);
  if (existing) {
    return existing;
  }

  const previous = state.mediaDurationQueue || Promise.resolve();
  const job = previous.catch(() => undefined).then(async () => {
    const duration = isRemoteMediaStorage()
      ? await probeRemoteMediaDuration({
          ...asset,
          storageNodeId: resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id,
        })
      : await probeMediaDurationFile(mediaFilePath(asset.storedName));
    if (!await savePostgresMediaDuration(database("jobs"), asset.id, duration)) {
      throw new Error("媒体文件在时长探测期间发生变化");
    }
    return duration;
  });
  state.mediaDurationQueue = job.then(() => undefined, () => undefined);
  jobs.set(key, job);
  void job.finally(() => jobs.delete(key)).catch(() => undefined);
  return job;
}
