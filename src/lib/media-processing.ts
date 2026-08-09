import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { inspectMp4AtomLayout } from "./mp4-faststart";

const FASTSTART_EXTENSIONS = new Set([".mp4", ".m4v", ".mov"]);
const FASTSTART_RESERVE_BYTES = 256 * 1024 * 1024;
const FASTSTART_TIMEOUT_MS = 30 * 60_000;

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

function runFastStartRemux(sourcePath: string, targetPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "warning",
        "-y",
        "-i",
        sourcePath,
        "-map",
        "0",
        "-c",
        "copy",
        "-map_metadata",
        "0",
        "-movflags",
        "+faststart",
        targetPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    let errorText = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, FASTSTART_TIMEOUT_MS);
    child.stderr?.on("data", (chunk) => {
      errorText = `${errorText}${String(chunk)}`.slice(-8_192);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorText.trim() || `ffmpeg exited with ${signal || code || "unknown status"}`));
    });
  });
}

export type MediaFastStartResult = "optimized" | "already-fast" | "unsupported";

export async function optimizeMediaFileFastStart(
  sourcePath: string,
  extensionHint = path.extname(sourcePath),
): Promise<MediaFastStartResult> {
  const extension = extensionHint.toLowerCase();
  if (!FASTSTART_EXTENSIONS.has(extension)) {
    return "unsupported";
  }
  const layout = inspectMp4AtomLayout(sourcePath);
  if (layout.fastStart) {
    return "already-fast";
  }
  if (layout.moovOffset === null || layout.mdatOffset === null) {
    return "unsupported";
  }

  const stat = await fs.promises.stat(sourcePath);
  const disk = fs.statfsSync(path.dirname(sourcePath));
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  if (availableBytes < stat.size + FASTSTART_RESERVE_BYTES) {
    throw new Error("磁盘空间不足，无法创建 faststart 临时文件");
  }

  const tempPath = path.join(
    path.dirname(sourcePath),
    `.${path.basename(sourcePath)}.faststart-${crypto.randomBytes(6).toString("hex")}${extension}`,
  );
  const backupPath = `${sourcePath}.faststart-replace`;
  if (fs.existsSync(backupPath)) {
    if (fs.existsSync(sourcePath)) {
      await fs.promises.rm(backupPath, { force: true });
    } else {
      await fs.promises.rename(backupPath, sourcePath);
    }
  }

  try {
    await runFastStartRemux(sourcePath, tempPath);
    if (!inspectMp4AtomLayout(tempPath).fastStart) {
      throw new Error("FFmpeg 输出仍未将 moov 移到媒体数据之前");
    }
    await fs.promises.rename(sourcePath, backupPath);
    try {
      await fs.promises.rename(tempPath, sourcePath);
    } catch (error) {
      await fs.promises.rename(backupPath, sourcePath);
      throw error;
    }
    await fs.promises.rm(backupPath, { force: true });
    return "optimized";
  } finally {
    await fs.promises.rm(tempPath, { force: true });
    if (fs.existsSync(backupPath) && !fs.existsSync(sourcePath)) {
      await fs.promises.rename(backupPath, sourcePath);
    }
  }
}
