import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "./config";
import { mediaFilePath, type MediaAsset } from "./media";
import { ensureMediaDuration } from "./media-metadata";

type ThumbnailGlobal = typeof globalThis & {
  mediaThumbnailJobs?: Map<string, Promise<string>>;
  mediaThumbnailQueue?: Promise<void>;
};

export type MediaThumbnailOptions = {
  fraction: number;
  cacheKey: string;
};

function execFileText(command: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 1024 * 1024, timeout }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

export function thumbnailSeekSeconds(durationSeconds: number, fraction = 1 / 3): number {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 && Number.isFinite(fraction) && fraction > 0 && fraction < 1
    ? durationSeconds * fraction
    : 0;
}

export function mediaThumbnailPath(id: number, cacheKey = "single-33"): string {
  const safeKey = cacheKey.replace(/[^a-z0-9-]/gi, "").slice(0, 80) || "default";
  return path.join(getMediaDir(), ".thumbnails", `${id}-${safeKey}.jpg`);
}

async function generateMediaThumbnail(asset: MediaAsset, options: MediaThumbnailOptions): Promise<string> {
  const sourcePath = mediaFilePath(asset.storedName);
  const sourceStat = fs.statSync(sourcePath);
  const targetPath = mediaThumbnailPath(asset.id, options.cacheKey);
  try {
    if (fs.statSync(targetPath).mtimeMs >= sourceStat.mtimeMs) {
      return targetPath;
    }
  } catch {
    // A missing or stale thumbnail is generated below.
  }

  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const seekSeconds = thumbnailSeekSeconds(await ensureMediaDuration(asset), options.fraction);
  if (!seekSeconds) {
    throw new Error("无法读取视频时长");
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `${asset.id}-${crypto.randomBytes(6).toString("hex")}.tmp.jpg`);
  try {
    await execFileText(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        seekSeconds.toFixed(3),
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        tempPath,
      ],
      30_000,
    );
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(tempPath, targetPath);
    return targetPath;
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

export function ensureMediaThumbnail(
  asset: MediaAsset,
  options: MediaThumbnailOptions = { fraction: 1 / 3, cacheKey: "single-33" },
): Promise<string> {
  const state = globalThis as ThumbnailGlobal;
  const jobs = state.mediaThumbnailJobs || new Map<string, Promise<string>>();
  state.mediaThumbnailJobs = jobs;
  const key = `${asset.id}:${asset.mtimeMs}:${options.cacheKey}`;
  const existing = jobs.get(key);
  if (existing) {
    return existing;
  }

  const previous = state.mediaThumbnailQueue || Promise.resolve();
  const job = previous.catch(() => undefined).then(() => generateMediaThumbnail(asset, options));
  state.mediaThumbnailQueue = job.then(() => undefined, () => undefined);
  jobs.set(key, job);
  void job.finally(() => jobs.delete(key)).catch(() => undefined);
  return job;
}

export function removeMediaThumbnail(id: number) {
  const directory = path.join(getMediaDir(), ".thumbnails");
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const fileName of fs.readdirSync(directory)) {
    if (fileName === `${id}.jpg` || fileName.startsWith(`${id}-`)) {
      fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }
}

export function clearMediaThumbnails(): number {
  const directory = path.join(getMediaDir(), ".thumbnails");
  if (!fs.existsSync(directory)) {
    return 0;
  }
  let removed = 0;
  for (const fileName of fs.readdirSync(directory)) {
    if (fileName.endsWith(".jpg")) {
      fs.rmSync(path.join(directory, fileName), { force: true });
      removed += 1;
    }
  }
  return removed;
}
