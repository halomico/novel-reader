import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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

export async function probeMediaDurationFile(sourcePath: string): Promise<number> {
  const stdout = await execFileText(
    process.env.FFPROBE_PATH || "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", sourcePath],
    15_000,
  );
  const duration = Number(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("无法读取媒体时长");
  }
  return duration;
}

export async function generateVideoThumbnailFile(params: {
  sourcePath: string;
  targetPath: string;
  durationSeconds: number;
  fraction: number;
}): Promise<string> {
  const seekSeconds =
    Number.isFinite(params.durationSeconds) &&
    params.durationSeconds > 0 &&
    Number.isFinite(params.fraction) &&
    params.fraction > 0 &&
    params.fraction < 1
      ? params.durationSeconds * params.fraction
      : 0;
  if (!seekSeconds) {
    throw new Error("无法读取视频时长");
  }

  await fs.promises.mkdir(path.dirname(params.targetPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(params.targetPath),
    `${path.basename(params.targetPath, path.extname(params.targetPath))}-${crypto.randomBytes(6).toString("hex")}.tmp.jpg`,
  );
  try {
    await execFileText(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        seekSeconds.toFixed(3),
        "-i",
        params.sourcePath,
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
    await fs.promises.rm(params.targetPath, { force: true });
    await fs.promises.rename(tempPath, params.targetPath);
    return params.targetPath;
  } finally {
    await fs.promises.rm(tempPath, { force: true });
  }
}
