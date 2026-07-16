import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "./config";
import { mediaFilePath, type MediaAsset } from "./media";
import { ensureMediaDuration } from "./media-metadata";

type ThumbnailGlobal = typeof globalThis & {
  mediaThumbnailJobs?: Map<string, Promise<string>>;
  mediaThumbnailPending?: ThumbnailQueueJob[];
  mediaThumbnailActive?: number;
};

type ThumbnailQueueJob = {
  run: () => Promise<string>;
  resolve: (value: string) => void;
  reject: (error: unknown) => void;
};

export type MediaThumbnailOptions = {
  fraction: number;
  cacheKey: string;
};

const THUMBNAIL_CONCURRENCY = 2;
const THUMBNAIL_PROFILE = "v2";

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
  return path.join(getMediaDir(), ".thumbnails", `${id}-${THUMBNAIL_PROFILE}-${safeKey}.jpg`);
}

export function mediaThumbnailEtag(id: number, mtimeMs: number, size: number): string {
  return `"media-thumbnail-${id}-${Math.floor(mtimeMs)}-${size}"`;
}

async function generateMediaThumbnail(asset: MediaAsset, options: MediaThumbnailOptions): Promise<string> {
  const sourcePath = mediaFilePath(asset.storedName);
  const sourceStat = await fs.promises.stat(sourcePath);
  const targetPath = mediaThumbnailPath(asset.id, options.cacheKey);
  try {
    if ((await fs.promises.stat(targetPath)).mtimeMs >= sourceStat.mtimeMs) {
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

  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
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
        "scale=640:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "5",
        tempPath,
      ],
      20_000,
    );
    await fs.promises.rm(targetPath, { force: true });
    await fs.promises.rename(tempPath, targetPath);
    return targetPath;
  } finally {
    await fs.promises.rm(tempPath, { force: true });
  }
}

function runNextThumbnailJobs() {
  const state = globalThis as ThumbnailGlobal;
  const queue = state.mediaThumbnailPending || [];
  state.mediaThumbnailPending = queue;
  state.mediaThumbnailActive ||= 0;
  while (state.mediaThumbnailActive < THUMBNAIL_CONCURRENCY && queue.length) {
    const queued = queue.shift()!;
    state.mediaThumbnailActive += 1;
    void queued.run()
      .then(queued.resolve, queued.reject)
      .finally(() => {
        state.mediaThumbnailActive = Math.max(0, (state.mediaThumbnailActive || 1) - 1);
        runNextThumbnailJobs();
      });
  }
}

function enqueueThumbnail(run: () => Promise<string>): Promise<string> {
  const state = globalThis as ThumbnailGlobal;
  state.mediaThumbnailPending ||= [];
  const job = new Promise<string>((resolve, reject) => {
    state.mediaThumbnailPending!.push({ run, resolve, reject });
  });
  runNextThumbnailJobs();
  return job;
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

  const job = enqueueThumbnail(() => generateMediaThumbnail(asset, options));
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
