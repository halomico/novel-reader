import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "./config";
import { mediaFilePath, type MediaAsset } from "./media";

type ThumbnailGlobal = typeof globalThis & {
  mediaThumbnailJobs?: Map<number, Promise<string>>;
  mediaThumbnailQueue?: Promise<void>;
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

export function thumbnailSeekSeconds(durationSeconds: number): number {
  return Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds / 3 : 0;
}

export function mediaThumbnailPath(id: number): string {
  return path.join(getMediaDir(), ".thumbnails", `${id}.jpg`);
}

async function generateMediaThumbnail(asset: MediaAsset): Promise<string> {
  const sourcePath = mediaFilePath(asset.storedName);
  const sourceStat = fs.statSync(sourcePath);
  const targetPath = mediaThumbnailPath(asset.id);
  try {
    if (fs.statSync(targetPath).mtimeMs >= sourceStat.mtimeMs) {
      return targetPath;
    }
  } catch {
    // A missing or stale thumbnail is generated below.
  }

  const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const durationOutput = await execFileText(
    ffprobe,
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath],
    15_000,
  );
  const seekSeconds = thumbnailSeekSeconds(Number(durationOutput.trim()));
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

export function ensureMediaThumbnail(asset: MediaAsset): Promise<string> {
  const state = globalThis as ThumbnailGlobal;
  const jobs = state.mediaThumbnailJobs || new Map<number, Promise<string>>();
  state.mediaThumbnailJobs = jobs;
  const existing = jobs.get(asset.id);
  if (existing) {
    return existing;
  }

  const previous = state.mediaThumbnailQueue || Promise.resolve();
  const job = previous.catch(() => undefined).then(() => generateMediaThumbnail(asset));
  state.mediaThumbnailQueue = job.then(() => undefined, () => undefined);
  jobs.set(asset.id, job);
  void job.finally(() => jobs.delete(asset.id)).catch(() => undefined);
  return job;
}

export function removeMediaThumbnail(id: number) {
  fs.rmSync(mediaThumbnailPath(id), { force: true });
}
