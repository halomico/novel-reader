import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "./config";
import { MEDIA_UPLOAD_CHUNK_BYTES, MEDIA_UPLOAD_MAX_BYTES } from "./media-node-protocol";
import {
  availableMediaStoredName,
  createMediaAsset,
  deleteMediaAssets,
  getMediaAsset,
  isMediaKind,
  MediaCategoryError,
  mediaFolderExists,
  mediaFolderFromStoredName,
  mediaFilePath,
  mediaStoredName,
  normalizeMediaFolder,
  normalizeMediaFile,
  normalizeMediaTitle,
  resolveVideoCategoryId,
  type MediaAsset,
  type MediaKind,
} from "./media";
import { optimizeMediaFileFastStart } from "./media-processing";
import {
  getActiveVideoTranscodeProfile,
  transcodeVideoToProfile,
  videoTranscodeOutputStoredName,
} from "./video-transcode";

export { MEDIA_UPLOAD_CHUNK_BYTES, MEDIA_UPLOAD_MAX_BYTES };

export type PreparedMediaUpload = {
  kind: MediaKind;
  categoryId: number | null;
  title: string;
  artist: string;
  description: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
};

type UploadSession = PreparedMediaUpload & {
  id: string;
  createdAt: number;
};

type CompletedUpload = {
  assetId: number;
  completedAt: number;
};

const localUploadLocks = new Map<string, Promise<void>>();

export class MediaUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function withLocalUploadLock<T>(uploadId: string, task: () => Promise<T>): Promise<T> {
  const previous = localUploadLocks.get(uploadId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const settled = current.then(() => undefined, () => undefined);
  localUploadLocks.set(uploadId, settled);
  return current.finally(() => {
    if (localUploadLocks.get(uploadId) === settled) {
      localUploadLocks.delete(uploadId);
    }
  });
}

function uploadTempDir(): string {
  return path.join(getMediaDir(), ".uploads");
}

function validUploadId(uploadId: string): boolean {
  return /^[a-f0-9]{32}$/.test(uploadId);
}

function sessionPath(uploadId: string): string {
  return path.join(uploadTempDir(), `${uploadId}.json`);
}

function partialPath(uploadId: string): string {
  return path.join(uploadTempDir(), `${uploadId}.part`);
}

function completedPath(uploadId: string): string {
  return path.join(uploadTempDir(), `${uploadId}.complete.json`);
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function readCompletedUpload(uploadId: string): MediaAsset | null {
  if (!validUploadId(uploadId)) return null;
  try {
    const completed = JSON.parse(fs.readFileSync(completedPath(uploadId), "utf8")) as CompletedUpload;
    return Number.isInteger(completed.assetId) ? getMediaAsset(completed.assetId) : null;
  } catch {
    return null;
  }
}

function cleanTitle(value: string, fileName: string): string {
  const extension = path.extname(fileName);
  const title = normalizeMediaTitle(value.trim() || path.basename(fileName, extension), extension);
  if (!title) {
    throw new MediaUploadError("标题应为 1 到 120 个字符");
  }
  return title;
}

function cleanDescription(value: string): string {
  const description = value.trim();
  if (description.length > 1000) {
    throw new MediaUploadError("简介不能超过 1000 个字符");
  }
  return description;
}

function cleanArtist(value: string, kind: MediaKind): string {
  if (kind === "file") {
    return "";
  }
  const artist = value.trim();
  if (artist.length > 80) {
    throw new MediaUploadError("作者不能超过 80 个字符");
  }
  return artist;
}

function readSession(uploadId: string): UploadSession {
  if (!validUploadId(uploadId)) {
    throw new MediaUploadError("上传任务不存在", 404);
  }
  try {
    const session = JSON.parse(fs.readFileSync(sessionPath(uploadId), "utf8")) as UploadSession;
    if (session.id !== uploadId || !isMediaKind(session.kind)) {
      throw new Error("invalid session");
    }
    return session;
  } catch {
    throw new MediaUploadError("上传任务不存在或已失效", 404);
  }
}

function pruneStaleUploads(now = Date.now()) {
  const tempDir = uploadTempDir();
  if (!fs.existsSync(tempDir)) {
    return;
  }
  for (const fileName of fs.readdirSync(tempDir)) {
    const completed = fileName.endsWith(".complete.json");
    const session = /^[a-f0-9]{32}\.json$/.test(fileName);
    if (!completed && !session) {
      continue;
    }
    const uploadId = completed
      ? fileName.slice(0, -".complete.json".length)
      : path.basename(fileName, ".json");
    try {
      const stat = fs.statSync(path.join(tempDir, fileName));
      if (now - stat.mtimeMs > 24 * 60 * 60 * 1000 && !localUploadLocks.has(uploadId)) {
        fs.rmSync(path.join(tempDir, fileName), { force: true });
        if (session) {
          fs.rmSync(partialPath(uploadId), { force: true });
        }
      }
    } catch {
      // Another request may have completed this upload while stale tasks are pruned.
    }
  }
}

export function startMediaUpload(params: {
  kind: unknown;
  categoryId?: unknown;
  title: string;
  artist?: string;
  description: string;
  folder?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): { uploadId: string; chunkBytes: number } {
  const prepared = prepareMediaUpload(params, { requireLocalFolder: true });
  fs.mkdirSync(uploadTempDir(), { recursive: true });
  pruneStaleUploads();
  const uploadId = crypto.randomBytes(16).toString("hex");
  const session: UploadSession = {
    ...prepared,
    id: uploadId,
    createdAt: Date.now(),
  };
  fs.writeFileSync(sessionPath(uploadId), JSON.stringify(session), { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.writeFileSync(partialPath(uploadId), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  return { uploadId, chunkBytes: MEDIA_UPLOAD_CHUNK_BYTES };
}

export function prepareMediaUpload(
  params: {
    kind: unknown;
    categoryId?: unknown;
    title: string;
    artist?: string;
    description: string;
    folder?: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  },
  options: { requireLocalFolder: boolean },
): PreparedMediaUpload {
  if (!isMediaKind(params.kind)) {
    throw new MediaUploadError("资源类型无效");
  }
  if (!Number.isInteger(params.sizeBytes) || params.sizeBytes <= 0 || params.sizeBytes > MEDIA_UPLOAD_MAX_BYTES) {
    throw new MediaUploadError("文件不能为空，且单个文件不能超过 5 GB");
  }
  const normalizedFile = normalizeMediaFile({
    kind: params.kind,
    fileName: params.fileName,
    mimeType: params.mimeType,
    allowVideoConversionSources: params.kind === "video" && Boolean(getActiveVideoTranscodeProfile()),
  });
  if (!normalizedFile) {
    throw new MediaUploadError(params.kind === "file" ? "文件名无效" : "请选择浏览器可播放的常见媒体格式");
  }
  const folder = normalizeMediaFolder(params.folder || "");
  if (folder === null || (options.requireLocalFolder && !mediaFolderExists(params.kind, folder))) {
    throw new MediaUploadError("上传目标文件夹不存在");
  }
  let categoryId: number | null = null;
  if (params.kind === "video") {
    try {
      categoryId = resolveVideoCategoryId(params.categoryId);
    } catch (error) {
      if (error instanceof MediaCategoryError) {
        throw new MediaUploadError(error.message);
      }
      throw error;
    }
  }

  const title = cleanTitle(params.title, normalizedFile.fileName);
  const fileName = `${title}${normalizedFile.extension}`;
  return {
    kind: params.kind,
    categoryId,
    title,
    artist: cleanArtist(params.artist || "", params.kind),
    description: cleanDescription(params.description),
    storedName: mediaStoredName(params.kind, folder, fileName),
    mimeType: normalizedFile.mimeType,
    sizeBytes: params.sizeBytes,
  };
}

export function appendMediaUploadChunk(uploadId: string, offset: number, buffer: Buffer): Promise<number> {
  return withLocalUploadLock(uploadId, async () => {
    const session = readSession(uploadId);
    if (!Number.isInteger(offset) || offset < 0 || buffer.length <= 0 || buffer.length > MEDIA_UPLOAD_CHUNK_BYTES) {
      throw new MediaUploadError("上传分片无效");
    }
    let handle: fs.promises.FileHandle;
    try {
      handle = await fs.promises.open(partialPath(uploadId), "r+");
    } catch {
      throw new MediaUploadError("上传任务不存在或已完成", 404);
    }
    try {
      const currentSize = (await handle.stat()).size;
      if (currentSize !== offset) {
        throw new MediaUploadError(`上传进度已变化:${currentSize}`, 409);
      }
      if (currentSize + buffer.length > session.sizeBytes) {
        throw new MediaUploadError("上传内容超过原文件大小");
      }
      const result = await handle.write(buffer, 0, buffer.length, currentSize);
      if (result.bytesWritten !== buffer.length) {
        throw new MediaUploadError("上传分片写入不完整", 500);
      }
      void fs.promises.utimes(sessionPath(uploadId), new Date(), new Date()).catch(() => undefined);
      return currentSize + result.bytesWritten;
    } finally {
      await handle.close();
    }
  });
}

export function getMediaUploadOffset(uploadId: string): Promise<number> {
  return withLocalUploadLock(uploadId, async () => {
    readSession(uploadId);
    try {
      return (await fs.promises.stat(partialPath(uploadId))).size;
    } catch {
      throw new MediaUploadError("上传任务不存在或已完成", 404);
    }
  });
}

export function finishMediaUpload(uploadId: string): Promise<MediaAsset> {
  return withLocalUploadLock(uploadId, async () => finishMediaUploadUnlocked(uploadId));
}

async function finishMediaUploadUnlocked(uploadId: string): Promise<MediaAsset> {
  const completedAsset = readCompletedUpload(uploadId);
  if (completedAsset) return completedAsset;
  const session = readSession(uploadId);
  const sourcePath = partialPath(uploadId);
  if (fs.statSync(sourcePath).size !== session.sizeBytes) {
    throw new MediaUploadError("文件尚未上传完成", 409);
  }
  fs.mkdirSync(getMediaDir(), { recursive: true });
  const requestedStoredName = session.storedName.replace(/\\/g, "/").startsWith(`${session.kind}/`)
    ? session.storedName
    : mediaStoredName(session.kind, "", session.storedName);
  const transcodeProfile = session.kind === "video" ? getActiveVideoTranscodeProfile() : null;
  const outputStoredName = transcodeProfile
    ? videoTranscodeOutputStoredName(requestedStoredName, transcodeProfile)
    : requestedStoredName;
  const storedName = availableMediaStoredName(
    session.kind,
    mediaFolderFromStoredName(outputStoredName, session.kind),
    path.basename(outputStoredName),
  );
  const finalPath = mediaFilePath(storedName);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  if (transcodeProfile) {
    try {
      await transcodeVideoToProfile(
        sourcePath,
        finalPath,
        transcodeProfile,
        path.extname(requestedStoredName),
      );
    } catch (error) {
      throw new MediaUploadError(
        error instanceof Error ? `视频兼容处理失败：${error.message}` : "视频兼容处理失败",
        422,
      );
    }
  } else if (session.kind === "video") {
    try {
      await optimizeMediaFileFastStart(sourcePath, path.extname(storedName));
    } catch (error) {
      throw new MediaUploadError(
        error instanceof Error ? `视频渐进播放优化失败：${error.message}` : "视频渐进播放优化失败",
        422,
      );
    }
  }
  if (!transcodeProfile) fs.renameSync(sourcePath, finalPath);
  const finalStat = fs.statSync(finalPath);
  let asset: MediaAsset;
  try {
    asset = createMediaAsset({
      kind: session.kind,
      categoryId: session.categoryId,
      title: path.basename(storedName, path.extname(storedName)) || session.title,
      artist: session.artist,
      description: session.description,
      fileName: path.basename(storedName),
      storedName,
      mimeType: transcodeProfile?.mimeType || session.mimeType,
      sizeBytes: finalStat.size,
      mtimeMs: Math.floor(finalStat.mtimeMs),
      durationSeconds: null,
    });
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    throw error;
  }
  try {
    writeJsonAtomic(completedPath(uploadId), {
      assetId: asset.id,
      completedAt: Date.now(),
    } satisfies CompletedUpload);
  } catch (error) {
    await deleteMediaAssets([asset.id]);
    throw error;
  }
  try {
    fs.rmSync(sessionPath(uploadId), { force: true });
  } catch {
    // The completed resource remains valid even if stale upload metadata cannot be removed immediately.
  }
  return asset;
}

export function cancelMediaUpload(uploadId: string): Promise<boolean> {
  return withLocalUploadLock(uploadId, async () => {
    if (!validUploadId(uploadId) || readCompletedUpload(uploadId)) {
      return false;
    }
    const found = fs.existsSync(sessionPath(uploadId)) || fs.existsSync(partialPath(uploadId));
    fs.rmSync(sessionPath(uploadId), { force: true });
    fs.rmSync(partialPath(uploadId), { force: true });
    return found;
  });
}
