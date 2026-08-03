import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type VideoTranscodeProfile = {
  id: string;
  label: string;
  bitrateTiers: readonly {
    maxPixels: number;
    videoBitrateKbps: number;
  }[];
  fallbackVideoBitrateKbps: number;
  audioBitrateKbps: number;
  extension: ".mp4";
  mimeType: "video/mp4";
};

export const VIDEO_TRANSCODE_PROFILES: readonly VideoTranscodeProfile[] = [
  {
    id: "standard-h264",
    label: "单文件 · 随分辨率",
    bitrateTiers: [
      { maxPixels: 640 * 360, videoBitrateKbps: 600 },
      { maxPixels: 854 * 480, videoBitrateKbps: 900 },
      { maxPixels: 1280 * 720, videoBitrateKbps: 1_600 },
      { maxPixels: 1920 * 1080, videoBitrateKbps: 2_800 },
    ],
    fallbackVideoBitrateKbps: 4_500,
    audioBitrateKbps: 128,
    extension: ".mp4",
    mimeType: "video/mp4",
  },
];

const VIDEO_TRANSCODE_TIMEOUT_MS = 12 * 60 * 60_000;
const VIDEO_TRANSCODE_RESERVE_BYTES = 512 * 1024 * 1024;
let videoTranscodeQueue: Promise<void> = Promise.resolve();

export function getActiveVideoTranscodeProfile(
  env: { VIDEO_TRANSCODE_PROFILE?: string } = {
    VIDEO_TRANSCODE_PROFILE: process.env.VIDEO_TRANSCODE_PROFILE,
  },
): VideoTranscodeProfile | null {
  const requested = (env.VIDEO_TRANSCODE_PROFILE || "source").trim().toLowerCase();
  if (!requested || requested === "source" || requested === "off") return null;
  const profile = VIDEO_TRANSCODE_PROFILES.find((item) => item.id === requested);
  if (!profile) throw new Error(`VIDEO_TRANSCODE_PROFILE 不受支持：${requested}`);
  return profile;
}

export function videoTranscodeOutputStoredName(
  storedName: string,
  profile: VideoTranscodeProfile,
): string {
  const extension = path.posix.extname(storedName);
  const stem = extension ? storedName.slice(0, -extension.length) : storedName;
  return `${stem}${profile.extension}`;
}

export function videoTranscodeArguments(
  sourcePath: string,
  outputPath: string,
  profile: VideoTranscodeProfile,
  resolution: { width: number; height: number },
): string[] {
  const videoBitrateKbps = selectVideoBitrateKbps(profile, resolution);
  return [
    "-hide_banner", "-loglevel", "warning", "-y", "-i", sourcePath,
    "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0",
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
    "-b:v", `${videoBitrateKbps}k`,
    "-maxrate", `${Math.round(videoBitrateKbps * 1.1)}k`,
    "-bufsize", `${videoBitrateKbps * 2}k`,
    "-c:a", "aac", "-b:a", `${profile.audioBitrateKbps}k`,
    "-movflags", "+faststart", outputPath,
  ];
}

export function selectVideoBitrateKbps(
  profile: VideoTranscodeProfile,
  resolution: { width: number; height: number },
): number {
  const pixels = Math.max(1, resolution.width) * Math.max(1, resolution.height);
  return profile.bitrateTiers.find((tier) => pixels <= tier.maxPixels)?.videoBitrateKbps
    ?? profile.fallbackVideoBitrateKbps;
}

function probeVideoResolution(sourcePath: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFPROBE_PATH || "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", sourcePath],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    let output = "";
    let errorText = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout?.on("data", (chunk) => {
      output = `${output}${String(chunk)}`.slice(-12_000);
    });
    child.stderr?.on("data", (chunk) => {
      errorText = `${errorText}${String(chunk)}`.slice(-12_000);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(errorText.trim() || `ffprobe exited with ${signal || code || "unknown status"}`));
        return;
      }
      try {
        const parsed = JSON.parse(output) as { streams?: { width?: number; height?: number }[] };
        const stream = parsed.streams?.[0];
        const width = Math.floor(Number(stream?.width || 0));
        const height = Math.floor(Number(stream?.height || 0));
        if (width <= 0 || height <= 0) throw new Error("视频分辨率无效");
        resolve({ width, height });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("无法读取视频分辨率"));
      }
    });
  });
}

async function runVideoTranscode(
  sourcePath: string,
  outputPath: string,
  profile: VideoTranscodeProfile,
): Promise<void> {
  const resolution = await probeVideoResolution(sourcePath);
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      videoTranscodeArguments(sourcePath, outputPath, profile, resolution),
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    let errorText = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), VIDEO_TRANSCODE_TIMEOUT_MS);
    child.stderr?.on("data", (chunk) => {
      errorText = `${errorText}${String(chunk)}`.slice(-12_000);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(errorText.trim() || `ffmpeg exited with ${signal || code || "unknown status"}`));
    });
  });
}

function withVideoTranscodeSlot<T>(task: () => Promise<T>): Promise<T> {
  const result = videoTranscodeQueue.catch(() => undefined).then(task);
  videoTranscodeQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function transcodeVideoToProfile(
  sourcePath: string,
  targetPath: string,
  profile: VideoTranscodeProfile,
): Promise<void> {
  return withVideoTranscodeSlot(async () => {
    const sourceStat = await fs.promises.stat(sourcePath);
    const disk = fs.statfsSync(path.dirname(sourcePath));
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    if (availableBytes < sourceStat.size + VIDEO_TRANSCODE_RESERVE_BYTES) {
      throw new Error("磁盘空间不足，无法创建单码率视频");
    }
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath, path.extname(targetPath))}.transcode-${crypto.randomBytes(6).toString("hex")}${profile.extension}`,
    );
    try {
      await runVideoTranscode(sourcePath, temporaryPath, profile);
      const outputStat = await fs.promises.stat(temporaryPath);
      if (outputStat.size <= 0) throw new Error("转码输出为空");
      await fs.promises.rename(temporaryPath, targetPath);
      await fs.promises.rm(sourcePath, { force: true });
    } finally {
      await fs.promises.rm(temporaryPath, { force: true });
    }
  });
}
