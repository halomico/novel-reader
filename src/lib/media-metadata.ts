import { mediaFilePath, saveMediaDuration, type MediaAsset } from "./media";
import { probeRemoteMediaDuration } from "./media-node-client";
import { probeMediaDurationFile } from "./media-processing";
import { isRemoteMediaStorage } from "./media-storage-config";

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
      ? await probeRemoteMediaDuration(asset)
      : await probeMediaDurationFile(mediaFilePath(asset.storedName));
    saveMediaDuration(asset.id, duration);
    return duration;
  });
  state.mediaDurationQueue = job.then(() => undefined, () => undefined);
  jobs.set(key, job);
  void job.finally(() => jobs.delete(key)).catch(() => undefined);
  return job;
}

export function scheduleMediaDurations(assets: MediaAsset[]) {
  for (const asset of assets) {
    if (asset.kind === "file" || (asset.durationSeconds && asset.durationSeconds > 0)) {
      continue;
    }
    void ensureMediaDuration(asset).catch(() => undefined);
  }
}

export function formatMediaDuration(durationSeconds: number | null): string {
  if (!durationSeconds || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "--:--";
  }
  const totalSeconds = Math.floor(durationSeconds);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}:${seconds}`;
  }
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${Math.floor(totalMinutes / 60)}:${minutes}:${seconds}`;
}
