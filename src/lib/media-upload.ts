import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "./config";
import {
  availableMediaStoredName,
  createMediaAsset,
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

export const MEDIA_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
export const MEDIA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;

type UploadSession = {
  id: string;
  kind: MediaKind;
  categoryId: number | null;
  title: string;
  artist: string;
  description: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
};

export class MediaUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
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
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const uploadId = path.basename(fileName, ".json");
    try {
      const stat = fs.statSync(path.join(tempDir, fileName));
      if (now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
        fs.rmSync(sessionPath(uploadId), { force: true });
        fs.rmSync(partialPath(uploadId), { force: true });
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
  if (!isMediaKind(params.kind)) {
    throw new MediaUploadError("资源类型无效");
  }
  if (!Number.isInteger(params.sizeBytes) || params.sizeBytes <= 0 || params.sizeBytes > MEDIA_UPLOAD_MAX_BYTES) {
    throw new MediaUploadError("文件不能为空，且单个文件不能超过 5 GB");
  }
  const normalizedFile = normalizeMediaFile({ kind: params.kind, fileName: params.fileName, mimeType: params.mimeType });
  if (!normalizedFile) {
    throw new MediaUploadError(params.kind === "file" ? "文件名无效" : "请选择浏览器可播放的常见媒体格式");
  }
  const folder = normalizeMediaFolder(params.folder || "");
  if (folder === null || !mediaFolderExists(params.kind, folder)) {
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

  fs.mkdirSync(uploadTempDir(), { recursive: true });
  pruneStaleUploads();
  const uploadId = crypto.randomBytes(16).toString("hex");
  const title = cleanTitle(params.title, normalizedFile.fileName);
  const fileName = `${title}${normalizedFile.extension}`;
  const session: UploadSession = {
    id: uploadId,
    kind: params.kind,
    categoryId,
    title,
    artist: cleanArtist(params.artist || "", params.kind),
    description: cleanDescription(params.description),
    storedName: mediaStoredName(params.kind, folder, fileName),
    mimeType: normalizedFile.mimeType,
    sizeBytes: params.sizeBytes,
    createdAt: Date.now(),
  };
  fs.writeFileSync(sessionPath(uploadId), JSON.stringify(session), { encoding: "utf8", flag: "wx", mode: 0o600 });
  fs.writeFileSync(partialPath(uploadId), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  return { uploadId, chunkBytes: MEDIA_UPLOAD_CHUNK_BYTES };
}

export function appendMediaUploadChunk(uploadId: string, offset: number, buffer: Buffer): number {
  const session = readSession(uploadId);
  if (!Number.isInteger(offset) || offset < 0 || buffer.length <= 0 || buffer.length > MEDIA_UPLOAD_CHUNK_BYTES) {
    throw new MediaUploadError("上传分片无效");
  }
  const currentSize = fs.statSync(partialPath(uploadId)).size;
  if (currentSize !== offset) {
    throw new MediaUploadError("上传进度已变化，请重新选择文件上传", 409);
  }
  if (currentSize + buffer.length > session.sizeBytes) {
    throw new MediaUploadError("上传内容超过原文件大小");
  }
  fs.appendFileSync(partialPath(uploadId), buffer);
  return currentSize + buffer.length;
}

export function finishMediaUpload(uploadId: string): MediaAsset {
  const session = readSession(uploadId);
  const sourcePath = partialPath(uploadId);
  if (fs.statSync(sourcePath).size !== session.sizeBytes) {
    throw new MediaUploadError("文件尚未上传完成", 409);
  }
  fs.mkdirSync(getMediaDir(), { recursive: true });
  const requestedStoredName = session.storedName.replace(/\\/g, "/").startsWith(`${session.kind}/`)
    ? session.storedName
    : mediaStoredName(session.kind, "", session.storedName);
  const storedName = availableMediaStoredName(
    session.kind,
    mediaFolderFromStoredName(requestedStoredName, session.kind),
    path.basename(requestedStoredName),
  );
  const finalPath = mediaFilePath(storedName);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.renameSync(sourcePath, finalPath);
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
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      mtimeMs: Math.floor(fs.statSync(finalPath).mtimeMs),
    });
  } catch (error) {
    fs.rmSync(finalPath, { force: true });
    throw error;
  }
  try {
    fs.rmSync(sessionPath(uploadId), { force: true });
  } catch {
    // The completed resource remains valid even if stale upload metadata cannot be removed immediately.
  }
  return asset;
}

export function cancelMediaUpload(uploadId: string): boolean {
  if (!validUploadId(uploadId)) {
    return false;
  }
  const found = fs.existsSync(sessionPath(uploadId)) || fs.existsSync(partialPath(uploadId));
  fs.rmSync(sessionPath(uploadId), { force: true });
  fs.rmSync(partialPath(uploadId), { force: true });
  return found;
}
