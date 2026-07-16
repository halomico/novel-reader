import { execFile } from "node:child_process";
import { mediaFilePath, saveMediaDuration, type MediaAsset } from "./media";

type MediaMetadataGlobal = typeof globalThis & {
  mediaDurationJobs?: Map<string, Promise<number>>;
  mediaDurationQueue?: Promise<void>;
};

function probeDuration(sourcePath: string): Promise<number> {
  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  return new Promise((resolve, reject) => {
    execFile(
      ffprobe,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath],
      { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15_000 },
      (error, stdout) => {
        const duration = Number(stdout.trim());
        if (error || !Number.isFinite(duration) || duration <= 0) {
          reject(error || new Error("无法读取媒体时长"));
          return;
        }
        resolve(duration);
      },
    );
  });
}

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
    const duration = await probeDuration(mediaFilePath(asset.storedName));
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

export async function loadMediaDurations(assets: MediaAsset[], concurrency = 3): Promise<MediaAsset[]> {
  const result = assets.map((asset) => ({ ...asset }));
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < result.length) {
      const index = nextIndex;
      nextIndex += 1;
      const asset = result[index];
      if (asset.kind === "file" || asset.durationSeconds) {
        continue;
      }
      try {
        asset.durationSeconds = await ensureMediaDuration(asset);
      } catch {
        asset.durationSeconds = null;
      }
    }
  };
  const workers = Math.min(Math.max(Math.floor(concurrency), 1), result.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return result;
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
