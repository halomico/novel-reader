import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { inspectMp4AtomLayout } from "./mp4-faststart";

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
    label: "智能兼容 · 无损优先",
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
const DIRECT_PLAY_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);
let videoTranscodeQueue: Promise<void> = Promise.resolve();

export type VideoInputProbe = {
  width: number;
  height: number;
  videoCodec: string;
  pixelFormat: string;
  audioCodec: string | null;
  durationSeconds?: number;
};

export type VideoProcessingMode = "passthrough" | "remux" | "audio-transcode" | "transcode";

export type VideoProcessingResult = {
  mode: VideoProcessingMode;
  videoCodec: string;
  audioCodec: string | null;
};

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

export function selectVideoProcessingMode(
  probe: VideoInputProbe,
  options: { sourceExtension: string; fastStart: boolean },
): VideoProcessingMode {
  const videoCompatible = probe.videoCodec === "h264" && DIRECT_PLAY_PIXEL_FORMATS.has(probe.pixelFormat);
  const audioCompatible = probe.audioCodec === null || probe.audioCodec === "aac";
  const extension = options.sourceExtension.toLowerCase();
  const mp4Container = extension === ".mp4" || extension === ".m4v";
  if (videoCompatible && audioCompatible) {
    return mp4Container && options.fastStart ? "passthrough" : "remux";
  }
  if (videoCompatible) {
    return "audio-transcode";
  }
  return "transcode";
}

export function videoProcessingArguments(
  sourcePath: string,
  outputPath: string,
  profile: VideoTranscodeProfile,
  probe: VideoInputProbe,
  mode: Exclude<VideoProcessingMode, "passthrough">,
): string[] {
  const args = [
    "-hide_banner", "-loglevel", "warning", "-y", "-i", sourcePath,
    "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "0",
  ];
  if (mode === "remux") {
    args.push("-c", "copy");
  } else if (mode === "audio-transcode") {
    args.push("-c:v", "copy", "-c:a", "aac", "-b:a", `${profile.audioBitrateKbps}k`);
  } else {
    const videoBitrateKbps = selectVideoBitrateKbps(profile, probe);
    args.push(
      "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-b:v", `${videoBitrateKbps}k`,
      "-maxrate", `${Math.round(videoBitrateKbps * 1.1)}k`,
      "-bufsize", `${videoBitrateKbps * 2}k`,
    );
    if (probe.audioCodec === "aac" || probe.audioCodec === null) {
      args.push("-c:a", "copy");
    } else {
      args.push("-c:a", "aac", "-b:a", `${profile.audioBitrateKbps}k`);
    }
  }
  args.push("-movflags", "+faststart", "-avoid_negative_ts", "make_zero", outputPath);
  return args;
}

export function selectVideoBitrateKbps(
  profile: VideoTranscodeProfile,
  resolution: { width: number; height: number },
): number {
  const pixels = Math.max(1, resolution.width) * Math.max(1, resolution.height);
  return profile.bitrateTiers.find((tier) => pixels <= tier.maxPixels)?.videoBitrateKbps
    ?? profile.fallbackVideoBitrateKbps;
}

export function probeVideoInput(sourcePath: string): Promise<VideoInputProbe> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFPROBE_PATH || "ffprobe",
      [
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name,pix_fmt,width,height,duration:format=duration",
        "-of", "json",
        sourcePath,
      ],
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
        const parsed = JSON.parse(output) as {
          streams?: Array<{
            codec_type?: string;
            codec_name?: string;
            pix_fmt?: string;
            width?: number;
            height?: number;
            duration?: string;
          }>;
          format?: { duration?: string };
        };
        const video = parsed.streams?.find((stream) => stream.codec_type === "video");
        const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
        const width = Math.floor(Number(video?.width || 0));
        const height = Math.floor(Number(video?.height || 0));
        if (width <= 0 || height <= 0) throw new Error("视频分辨率无效");
        const videoCodec = String(video?.codec_name || "").trim().toLowerCase();
        if (!videoCodec) throw new Error("无法读取视频编码");
        const streamDurationSeconds = Math.max(
          0,
          ...(parsed.streams || []).map((stream) => Number(stream.duration) || 0),
        );
        const durationSeconds = Number(parsed.format?.duration) || streamDurationSeconds;
        resolve({
          width,
          height,
          videoCodec,
          pixelFormat: String(video?.pix_fmt || "").trim().toLowerCase(),
          audioCodec: audio?.codec_name ? String(audio.codec_name).trim().toLowerCase() : null,
          durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0
            ? durationSeconds
            : undefined,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error("无法读取视频编码信息"));
      }
    });
  });
}

function runVideoProcessing(
  sourcePath: string,
  outputPath: string,
  profile: VideoTranscodeProfile,
  probe: VideoInputProbe,
  mode: Exclude<VideoProcessingMode, "passthrough">,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.FFMPEG_PATH || "ffmpeg",
      videoProcessingArguments(sourcePath, outputPath, profile, probe, mode),
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
  sourceExtension = path.extname(sourcePath),
): Promise<VideoProcessingResult> {
  return withVideoTranscodeSlot(async () => {
    const probe = await probeVideoInput(sourcePath);
    let fastStart = false;
    try {
      fastStart = inspectMp4AtomLayout(sourcePath).fastStart;
    } catch {
      // Non-ISO containers are handled by FFmpeg below.
    }
    const mode = selectVideoProcessingMode(probe, { sourceExtension, fastStart });
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    if (mode === "passthrough") {
      await fs.promises.rename(sourcePath, targetPath);
      return { mode, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec };
    }

    const sourceStat = await fs.promises.stat(sourcePath);
    const disk = fs.statfsSync(path.dirname(sourcePath));
    const availableBytes = Number(disk.bavail) * Number(disk.bsize);
    if (availableBytes < sourceStat.size + VIDEO_TRANSCODE_RESERVE_BYTES) {
      throw new Error("磁盘空间不足，无法创建单码率视频");
    }
    const temporaryPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath, path.extname(targetPath))}.transcode-${crypto.randomBytes(6).toString("hex")}${profile.extension}`,
    );
    try {
      await runVideoProcessing(sourcePath, temporaryPath, profile, probe, mode);
      const outputStat = await fs.promises.stat(temporaryPath);
      if (outputStat.size <= 0) throw new Error("转码输出为空");
      const outputProbe = await probeVideoInput(temporaryPath);
      if (
        outputProbe.videoCodec !== "h264" ||
        !DIRECT_PLAY_PIXEL_FORMATS.has(outputProbe.pixelFormat) ||
        (outputProbe.audioCodec !== null && outputProbe.audioCodec !== "aac")
      ) {
        throw new Error("处理结果仍不是兼容的 H.264/AAC 视频");
      }
      if (!inspectMp4AtomLayout(temporaryPath).fastStart) {
        throw new Error("处理结果未启用 MP4 faststart");
      }
      await fs.promises.rename(temporaryPath, targetPath);
      await fs.promises.rm(sourcePath, { force: true });
      return { mode, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec };
    } finally {
      await fs.promises.rm(temporaryPath, { force: true });
    }
  });
}
