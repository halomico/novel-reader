import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import { normalizeMediaStoragePath, resolveMediaStoragePath } from "./media-storage-path";
import {
  probeVideoInput,
  type VideoInputProbe,
} from "./video-transcode";

const execFileAsync = promisify(execFile);

export const PLAYBACK_HLS_SEGMENT_SECONDS = 6;
export const PLAYBACK_HLS_MANIFEST_FILE = "index.m3u8";
const PLAYBACK_HLS_INIT_FILE = "init.mp4";
const PLAYBACK_HLS_BUNDLE_PATTERN = /^bundle-[0-9]{4}\.m4s$/u;
const PLAYBACK_HLS_TRANSCODE_TIMEOUT_MS = 12 * 60 * 60_000;
const DIRECT_H264_PIXEL_FORMATS = new Set(["yuv420p", "yuvj420p"]);
export const VIDEO_HLS_INCOMPATIBLE_ERROR = "视频编码不兼容，已隔离，未执行 HLS";

export type VideoHlsPackageResult = {
  version: string;
  manifestPath: string;
  directoryPath: string;
};

export type PlaybackHlsByteRange = {
  sourceStart: number;
  targetStart: number;
  length: number;
};

export type PlaybackHlsBundlePlan = {
  fileName: string;
  ranges: PlaybackHlsByteRange[];
  sizeBytes: number;
};

export type PlaybackHlsPlan = {
  manifest: string;
  initRange: { sourceStart: number; length: number };
  bundles: PlaybackHlsBundlePlan[];
};

export type PlaybackHlsFileSet = {
  files: Array<{ fileName: string; filePath: string; sizeBytes: number }>;
  sizeBytes: number;
};

function sourceVersion(mtimeMs: number, sizeBytes: number): string {
  return `${Math.max(0, Math.floor(mtimeMs))}-${Math.max(0, Math.floor(sizeBytes))}`;
}

export function mediaPlaybackSourceVersion(mtimeMs: number, sizeBytes: number): string {
  return sourceVersion(mtimeMs, sizeBytes);
}

function safeAssetId(mediaId: number): string {
  if (!Number.isInteger(mediaId) || mediaId <= 0) throw new Error("媒体标识无效");
  return String(mediaId);
}

function hlsRootPath(root: string, mediaId: number): string {
  return resolveMediaStoragePath(root, `video/.hls/${safeAssetId(mediaId)}`);
}

export function playbackHlsDirectoryPath(root: string, mediaId: number, version: string): string {
  if (!/^[0-9]+-[0-9]+$/u.test(version)) throw new Error("播放版本无效");
  return path.join(hlsRootPath(root, mediaId), version);
}

export function playbackHlsManifestPath(root: string, mediaId: number, version: string): string {
  return path.join(playbackHlsDirectoryPath(root, mediaId, version), PLAYBACK_HLS_MANIFEST_FILE);
}

function isPlaybackResourceFileName(fileName: string): boolean {
  return fileName === PLAYBACK_HLS_MANIFEST_FILE ||
    fileName === PLAYBACK_HLS_INIT_FILE ||
    PLAYBACK_HLS_BUNDLE_PATTERN.test(fileName);
}

function playbackHlsStoredPath(
  mediaId: number,
  version: string,
  fileName = PLAYBACK_HLS_MANIFEST_FILE,
): string {
  if (!/^[0-9]+-[0-9]+$/u.test(version)) throw new Error("播放版本无效");
  if (!isPlaybackResourceFileName(fileName)) throw new Error("播放文件无效");
  return `video/.hls/${safeAssetId(mediaId)}/${version}/${fileName}`;
}

function validSource(sourcePath: string, sizeBytes: number, mtimeMs: number): void {
  const stat = fs.statSync(sourcePath);
  if (
    !stat.isFile() ||
    stat.size <= 0 ||
    stat.size !== Math.floor(sizeBytes) ||
    Math.floor(stat.mtimeMs) !== Math.floor(mtimeMs)
  ) {
    throw new Error("媒体文件版本已变化");
  }
}

function finiteEnvNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function playbackRetireGraceMs(): number {
  const ttlSeconds = Math.min(
    Math.max(Math.floor(finiteEnvNumber(process.env.MEDIA_URL_TTL_SECONDS, 21_600)), 300),
    86_400,
  );
  return Math.max(2 * 60 * 60_000, ttlSeconds * 1_000 + 60 * 60_000);
}

export function estimatePlaybackHlsTemporaryBytes(
  sizeBytes: number,
  _probe: VideoInputProbe,
): number {
  return Math.max(Math.floor(sizeBytes), 512 * 1024 * 1024);
}

function ensurePackagingCapacity(
  sourcePath: string,
  sizeBytes: number,
  probe: VideoInputProbe,
): void {
  const disk = fs.statfsSync(path.dirname(sourcePath));
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  const minimumFreeBytes = Math.min(
    Math.max(finiteEnvNumber(process.env.MEDIA_HLS_MIN_FREE_GB, 5), 0),
    10_000,
  ) * 1024 * 1024 * 1024;
  const temporaryPeakBytes = estimatePlaybackHlsTemporaryBytes(sizeBytes, probe);
  if (availableBytes < minimumFreeBytes + temporaryPeakBytes) {
    throw new Error("媒体节点可用空间低于 HLS 打包安全线");
  }
}

function parseByteRange(
  value: string,
  previousEnd: number,
): { sourceStart: number; length: number; nextEnd: number } {
  const match = /^([0-9]+)(?:@([0-9]+))?$/u.exec(value.trim());
  const length = Number(match?.[1] || 0);
  const sourceStart = match?.[2] == null ? previousEnd : Number(match[2]);
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    !Number.isSafeInteger(sourceStart) ||
    sourceStart < 0
  ) {
    throw new Error("HLS 字节范围无效");
  }
  return { sourceStart, length, nextEnd: sourceStart + length };
}

export function planSingleFileHlsBundles(
  manifest: string,
  sourceFileName: string,
  sourceFileSize: number,
  targetBundleBytes = 32 * 1024 * 1024,
): PlaybackHlsPlan {
  if (!manifest.startsWith("#EXTM3U") || !Number.isSafeInteger(sourceFileSize) || sourceFileSize <= 0) {
    throw new Error("HLS 播放清单无效");
  }
  const safeTargetBytes = Math.max(Math.floor(targetBundleBytes), 1);
  const lines = manifest.split(/\r?\n/u);
  const output: string[] = [];
  const bundles: PlaybackHlsBundlePlan[] = [];
  let initRange: PlaybackHlsPlan["initRange"] | null = null;
  let previousEnd = 0;
  let pendingBundleFile = "";
  let mediaRangeCount = 0;

  for (const line of lines) {
    const map = /^#EXT-X-MAP:URI="([^"]+)",BYTERANGE="([^"]+)"$/u.exec(line);
    if (map) {
      if (map[1] !== sourceFileName || initRange) throw new Error("HLS 初始化段无效");
      const range = parseByteRange(map[2], previousEnd);
      if (range.nextEnd > sourceFileSize) throw new Error("HLS 初始化段超出文件范围");
      initRange = { sourceStart: range.sourceStart, length: range.length };
      previousEnd = range.nextEnd;
      output.push(`#EXT-X-MAP:URI="${PLAYBACK_HLS_INIT_FILE}"`);
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      if (pendingBundleFile) throw new Error("HLS 分段缺少媒体 URI");
      const range = parseByteRange(line.slice("#EXT-X-BYTERANGE:".length), previousEnd);
      if (range.nextEnd > sourceFileSize) throw new Error("HLS 分段超出文件范围");
      let bundle = bundles.at(-1);
      if (!bundle || (bundle.sizeBytes > 0 && bundle.sizeBytes + range.length > safeTargetBytes)) {
        bundle = {
          fileName: `bundle-${String(bundles.length).padStart(4, "0")}.m4s`,
          ranges: [],
          sizeBytes: 0,
        };
        bundles.push(bundle);
      }
      bundle.ranges.push({
        sourceStart: range.sourceStart,
        targetStart: bundle.sizeBytes,
        length: range.length,
      });
      output.push(`#EXT-X-BYTERANGE:${range.length}@${bundle.sizeBytes}`);
      bundle.sizeBytes += range.length;
      previousEnd = range.nextEnd;
      pendingBundleFile = bundle.fileName;
      mediaRangeCount += 1;
      continue;
    }
    if (line && !line.startsWith("#")) {
      if (!pendingBundleFile || line.trim() !== sourceFileName) {
        throw new Error("HLS 播放清单包含未知媒体资源");
      }
      output.push(pendingBundleFile);
      pendingBundleFile = "";
      continue;
    }
    output.push(line);
  }

  if (!initRange || pendingBundleFile || mediaRangeCount === 0 || !manifest.includes("#EXT-X-ENDLIST")) {
    throw new Error("HLS 播放清单不完整");
  }
  return {
    manifest: `${output.join("\n").replace(/\n+$/u, "")}\n`,
    initRange,
    bundles,
  };
}

function directH264(probe: VideoInputProbe): boolean {
  return probe.videoCodec === "h264" && DIRECT_H264_PIXEL_FORMATS.has(probe.pixelFormat);
}

export function isDirectHlsCompatible(probe: VideoInputProbe): boolean {
  if (!directH264(probe)) return false;
  if (probe.audioCodec !== null && probe.audioCodec !== "aac") return false;
  return true;
}

function codecArguments(probe: VideoInputProbe): string[] {
  if (!isDirectHlsCompatible(probe)) throw new Error(VIDEO_HLS_INCOMPATIBLE_ERROR);
  const args = ["-c:v", "copy"];
  if (probe.audioCodec === null) {
    args.push("-an");
  } else {
    args.push("-c:a", "copy");
  }
  return args;
}

async function runFfmpegPass(
  sourcePath: string,
  directoryPath: string,
  probe: VideoInputProbe,
): Promise<{ manifestPath: string; manifest: string }> {
  const manifestPath = path.join(directoryPath, PLAYBACK_HLS_MANIFEST_FILE);
  await Promise.all([
    fs.promises.rm(manifestPath, { force: true }),
    fs.promises.rm(path.join(directoryPath, PLAYBACK_HLS_INIT_FILE), { force: true }),
  ]);
  const result = await execFileAsync(
    process.env.FFMPEG_PATH || "ffmpeg",
    [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-i", sourcePath,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      ...codecArguments(probe),
      "-avoid_negative_ts", "make_zero",
      "-f", "hls",
      "-hls_time", String(PLAYBACK_HLS_SEGMENT_SECONDS),
      "-hls_playlist_type", "vod",
      "-hls_segment_type", "fmp4",
      "-hls_flags", "independent_segments",
      "-hls_fmp4_init_filename", PLAYBACK_HLS_INIT_FILE,
      "-hls_segment_filename", path.join(directoryPath, "bundle-%04d.m4s"),
      path.basename(manifestPath),
    ],
    {
      cwd: directoryPath,
      timeout: PLAYBACK_HLS_TRANSCODE_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  void result;
  const manifest = await fs.promises.readFile(manifestPath, "utf8");
  if (
    !manifest.startsWith("#EXTM3U") ||
    !manifest.includes("#EXT-X-MAP:URI=") ||
    !manifest.includes(PLAYBACK_HLS_INIT_FILE) ||
    !manifest.match(/(?:^|\n)bundle-[0-9]{4}\.m4s(?:\n|$)/mu) ||
    !manifest.includes("#EXT-X-ENDLIST")
  ) {
    throw new Error("HLS 播放清单不完整");
  }
  return { manifestPath, manifest };
}

async function validatePackagedPlayback(manifestPath: string): Promise<number> {
  const result = await execFileAsync(
    process.env.FFPROBE_PATH || "ffprobe",
    [
      "-v", "error",
      "-show_entries", "stream=codec_type,codec_name,pix_fmt:format=duration",
      "-of", "json",
      manifestPath,
    ],
    { timeout: 60_000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: "utf8" },
  );
  const parsed = JSON.parse(String(result.stdout || "{}")) as {
    streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string }>;
    format?: { duration?: string };
  };
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audio = parsed.streams?.find((stream) => stream.codec_type === "audio");
  if (
    video?.codec_name !== "h264" ||
    !DIRECT_H264_PIXEL_FORMATS.has(String(video.pix_fmt || "")) ||
    (audio && audio.codec_name !== "aac")
  ) {
    throw new Error("HLS 成品不是兼容的 H.264/AAC");
  }
  const durationSeconds = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error("HLS 成品时长无效");
  }
  return durationSeconds;
}

async function runFfmpeg(
  sourcePath: string,
  directoryPath: string,
  probe: VideoInputProbe,
): Promise<void> {
  const temporaryPath = `${directoryPath}.${crypto.randomBytes(8).toString("hex")}.tmp`;
  await fs.promises.mkdir(path.dirname(directoryPath), { recursive: true });
  await fs.promises.rm(temporaryPath, { recursive: true, force: true });
  await fs.promises.mkdir(temporaryPath, { recursive: true });
  try {
    const pass = await runFfmpegPass(sourcePath, temporaryPath, probe);
    await validatePackagedPlayback(pass.manifestPath);
    await fs.promises.rm(directoryPath, { recursive: true, force: true });
    await fs.promises.rename(temporaryPath, directoryPath);
  } finally {
    await fs.promises.rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function packageVideoHls(input: {
  root: string;
  mediaId: number;
  storedName: string;
  mtimeMs: number;
  sizeBytes: number;
}): Promise<VideoHlsPackageResult> {
  const normalized = normalizeMediaStoragePath(input.storedName);
  if (!normalized || !normalized.startsWith("video/") || normalized.includes("/.hls/")) {
    throw new Error("视频存储路径无效");
  }
  const version = sourceVersion(input.mtimeMs, input.sizeBytes);
  const directoryPath = playbackHlsDirectoryPath(input.root, input.mediaId, version);
  const manifestPath = path.join(directoryPath, PLAYBACK_HLS_MANIFEST_FILE);
  const sourcePath = resolveMediaStoragePath(input.root, normalized);
  validSource(sourcePath, input.sizeBytes, input.mtimeMs);
  try {
    const existingManifest = await readPlaybackHlsManifest(input.root, playbackHlsStoredPath(input.mediaId, version));
    if (!existingManifest.includes("#EXT-X-BYTERANGE:")) {
      return {
        version,
        manifestPath: playbackHlsStoredPath(input.mediaId, version),
        directoryPath,
      };
    }
  } catch {
    // Build the immutable version below.
  }
  const probe = await probeVideoInput(sourcePath);
  if (!isDirectHlsCompatible(probe)) {
    throw new Error(VIDEO_HLS_INCOMPATIBLE_ERROR);
  }
  ensurePackagingCapacity(sourcePath, input.sizeBytes, probe);
  await runFfmpeg(sourcePath, directoryPath, probe);
  validSource(sourcePath, input.sizeBytes, input.mtimeMs);
  return {
    version,
    manifestPath: playbackHlsStoredPath(input.mediaId, version),
    directoryPath,
  };
}

export function resolvePlaybackHlsFile(
  root: string,
  manifestPath: string,
  requestedFile: string,
): string | null {
  const normalizedManifest = normalizeMediaStoragePath(manifestPath);
  if (
    !normalizedManifest ||
    !normalizedManifest.startsWith("video/.hls/") ||
    !normalizedManifest.endsWith("/index.m3u8")
  ) {
    return null;
  }
  const directory = path.posix.dirname(normalizedManifest);
  const normalizedFile = requestedFile.trim();
  if (!isPlaybackResourceFileName(normalizedFile)) return null;
  const storedPath = normalizeMediaStoragePath(`${directory}/${normalizedFile}`);
  if (!storedPath) return null;
  try {
    return resolveMediaStoragePath(root, storedPath);
  } catch {
    return null;
  }
}

export async function readPlaybackHlsManifest(root: string, manifestPath: string): Promise<string> {
  const filePath = resolvePlaybackHlsFile(root, manifestPath, PLAYBACK_HLS_MANIFEST_FILE);
  if (!filePath) throw new Error("HLS 播放清单路径无效");
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 512 * 1024) {
    throw new Error("HLS 播放清单无效");
  }
  const manifest = await fs.promises.readFile(filePath, "utf8");
  const resourceNames = new Set<string>();
  const requiredBundleSizes = new Map<string, number>();
  let pendingRange: { offset: number; length: number } | null = null;
  let segmentCount = 0;
  const map = /^#EXT-X-MAP:URI="([^"]+)"/mu.exec(manifest);
  if (map) resourceNames.add(map[1]);
  for (const line of manifest.split(/\r?\n/u)) {
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      if (pendingRange) throw new Error("HLS 播放清单缺少分段资源");
      const match = /^#EXT-X-BYTERANGE:([0-9]+)@([0-9]+)$/u.exec(line);
      const length = Number(match?.[1] || 0);
      const offset = Number(match?.[2] ?? -1);
      if (!Number.isSafeInteger(length) || length <= 0 || !Number.isSafeInteger(offset) || offset < 0) {
        throw new Error("HLS 播放清单字节范围无效");
      }
      pendingRange = { offset, length };
      continue;
    }
    if (line && !line.startsWith("#")) {
      const resourceName = line.trim();
      if (!PLAYBACK_HLS_BUNDLE_PATTERN.test(resourceName)) {
        throw new Error("HLS 播放清单分段格式无效");
      }
      resourceNames.add(resourceName);
      if (pendingRange) {
        requiredBundleSizes.set(
          resourceName,
          Math.max(requiredBundleSizes.get(resourceName) || 0, pendingRange.offset + pendingRange.length),
        );
      }
      pendingRange = null;
      segmentCount += 1;
    }
  }
  if (
    !manifest.startsWith("#EXTM3U") ||
    !manifest.includes("#EXT-X-ENDLIST") ||
    !resourceNames.has(PLAYBACK_HLS_INIT_FILE) ||
    pendingRange ||
    segmentCount === 0 ||
    !Array.from(resourceNames).some((name) => PLAYBACK_HLS_BUNDLE_PATTERN.test(name))
  ) {
    throw new Error("HLS 播放清单无效");
  }
  for (const resourceName of resourceNames) {
    const resourcePath = resolvePlaybackHlsFile(root, manifestPath, resourceName);
    if (!resourcePath) throw new Error("HLS 播放资源不完整");
    const resourceStat = await fs.promises.stat(resourcePath);
    if (
      !resourceStat.isFile() ||
      resourceStat.size <= 0 ||
      resourceStat.size < (requiredBundleSizes.get(resourceName) || 1)
    ) {
      throw new Error("HLS 播放资源不完整");
    }
  }
  return manifest;
}

export async function verifyPlaybackHls(
  root: string,
  manifestPath: string,
): Promise<{ sizeBytes: number; fileCount: number; durationSeconds: number }> {
  const fileSet = await getPlaybackHlsFileSet(root, manifestPath);
  const resolvedManifest = resolvePlaybackHlsFile(root, manifestPath, PLAYBACK_HLS_MANIFEST_FILE);
  if (!resolvedManifest) throw new Error("HLS 播放清单路径无效");
  const durationSeconds = await validatePackagedPlayback(resolvedManifest);
  return { sizeBytes: fileSet.sizeBytes, fileCount: fileSet.files.length, durationSeconds };
}

export async function getPlaybackHlsFileSet(
  root: string,
  manifestPath: string,
): Promise<PlaybackHlsFileSet> {
  const manifest = await readPlaybackHlsManifest(root, manifestPath);
  const orderedNames: string[] = [];
  const map = /^#EXT-X-MAP:URI="([^"]+)"/mu.exec(manifest);
  if (map) orderedNames.push(map[1]);
  for (const line of manifest.split(/\r?\n/u)) {
    const fileName = line.trim();
    if (fileName && !fileName.startsWith("#") && !orderedNames.includes(fileName)) {
      orderedNames.push(fileName);
    }
  }
  const files = await Promise.all(orderedNames.map(async (fileName) => {
    const filePath = resolvePlaybackHlsFile(root, manifestPath, fileName);
    if (!filePath) throw new Error("HLS 播放文件路径无效");
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile() || stat.size <= 0) throw new Error("HLS 播放文件不完整");
    return { fileName, filePath, sizeBytes: stat.size };
  }));
  return {
    files,
    sizeBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
  };
}

export function createPlaybackHlsFileStream(
  fileSet: PlaybackHlsFileSet,
  start: number,
  end: number,
): Readable {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= fileSet.sizeBytes
  ) {
    throw new Error("HLS 虚拟文件范围无效");
  }
  async function* chunks() {
    let fileOffset = 0;
    for (const file of fileSet.files) {
      const fileEnd = fileOffset + file.sizeBytes - 1;
      if (end < fileOffset) break;
      if (start <= fileEnd && end >= fileOffset) {
        const localStart = Math.max(start - fileOffset, 0);
        const localEnd = Math.min(end - fileOffset, file.sizeBytes - 1);
        for await (const chunk of fs.createReadStream(file.filePath, {
          start: localStart,
          end: localEnd,
        })) {
          yield chunk;
        }
      }
      fileOffset += file.sizeBytes;
    }
  }
  return Readable.from(chunks());
}

function retireMarkerPath(directoryPath: string): string {
  return path.join(directoryPath, ".retired-at");
}

function readRetiredAt(directoryPath: string): number | null {
  try {
    const value = Number(fs.readFileSync(retireMarkerPath(directoryPath), "utf8"));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function scheduleRetiredVersionRemoval(
  root: string,
  mediaId: number,
  keepVersion: string,
  delayMs: number,
): void {
  const timer = setTimeout(
    () => prunePlaybackHlsVersions(root, mediaId, keepVersion),
    Math.max(1_000, Math.min(delayMs, 2_147_000_000)),
  );
  timer.unref?.();
}

export function prunePlaybackHlsVersions(
  root: string,
  mediaId: number,
  keepVersion: string,
  now = Date.now(),
): void {
  const rootPath = hlsRootPath(root, mediaId);
  if (!fs.existsSync(rootPath)) return;
  const graceMs = playbackRetireGraceMs();
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.name === keepVersion ||
      !/^[0-9]+-[0-9]+$/u.test(entry.name)
    ) {
      continue;
    }
    const directoryPath = path.join(rootPath, entry.name);
    let retiredAt = readRetiredAt(directoryPath);
    if (!retiredAt) {
      retiredAt = now;
      try {
        fs.writeFileSync(retireMarkerPath(directoryPath), String(retiredAt), {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
          throw error;
        }
        retiredAt = readRetiredAt(directoryPath) || now;
      }
    }
    const remainingMs = retiredAt + graceMs - now;
    if (remainingMs <= 0) {
      fs.rmSync(directoryPath, { recursive: true, force: true });
    } else {
      scheduleRetiredVersionRemoval(root, mediaId, keepVersion, remainingMs + 1_000);
    }
  }
}

export function cleanupRetiredPlaybackHlsVersions(root: string, now = Date.now()): number {
  const hlsRoot = resolveMediaStoragePath(root, "video/.hls");
  if (!fs.existsSync(hlsRoot)) return 0;
  const graceMs = playbackRetireGraceMs();
  let removed = 0;
  for (const mediaEntry of fs.readdirSync(hlsRoot, { withFileTypes: true })) {
    if (!mediaEntry.isDirectory() || !/^[0-9]+$/u.test(mediaEntry.name)) continue;
    const mediaDirectory = path.join(hlsRoot, mediaEntry.name);
    for (const versionEntry of fs.readdirSync(mediaDirectory, { withFileTypes: true })) {
      if (!versionEntry.isDirectory() || !/^[0-9]+-[0-9]+$/u.test(versionEntry.name)) continue;
      const versionDirectory = path.join(mediaDirectory, versionEntry.name);
      const retiredAt = readRetiredAt(versionDirectory);
      if (retiredAt && retiredAt + graceMs <= now) {
        fs.rmSync(versionDirectory, { recursive: true, force: true });
        removed += 1;
      }
    }
  }
  return removed;
}

export function removePlaybackHlsVersions(root: string, mediaId: number): void {
  fs.rmSync(hlsRootPath(root, mediaId), { recursive: true, force: true });
}
