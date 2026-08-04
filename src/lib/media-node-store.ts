import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  MEDIA_UPLOAD_CHUNK_BYTES,
  MEDIA_UPLOAD_MAX_BYTES,
  MEDIA_UPLOAD_SESSION_TTL_MS,
  type MediaNodeKind,
  type MediaNodeManifestFile,
  type MediaNodeManifestFolder,
  type MediaNodeManifestPage,
  type MediaNodeUploadReceipt,
  type MediaNodeUploadRequest,
  type MediaNodeUploadStart,
} from "./media-node-protocol";
import { generateVideoThumbnailFile, optimizeMediaFileFastStart, probeMediaDurationFile } from "./media-processing";
import { isIgnoredMediaStorageEntry } from "./media-scan-filter";
import { normalizeMediaStoragePath, resolveMediaStoragePath } from "./media-storage-path";
import {
  getActiveVideoTranscodeProfile,
  transcodeVideoToProfile,
  videoTranscodeOutputStoredName,
} from "./video-transcode";

type UploadSession = MediaNodeUploadRequest & {
  id: string;
  tokenHash: string;
  createdAt: number;
  finalStoredName?: string;
};

type ManifestSnapshot = {
  createdAt: number;
  entries: Array<
    | { type: "file"; value: MediaNodeManifestFile }
    | { type: "folder"; value: MediaNodeManifestFolder }
  >;
};

type MediaThumbnailRequest = {
  storedName: string;
  mtimeMs: number;
  sizeBytes: number;
  percent: number;
  durationSeconds?: number | null;
};

const MEDIA_KINDS: MediaNodeKind[] = ["video", "audio", "file"];
const MANIFEST_CACHE_MS = 5 * 60 * 1000;
const THUMBNAIL_CONCURRENCY = 2;
const MAX_NORMALIZED_COVER_BYTES = 2 * 1024 * 1024;
const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".zip": "application/zip",
};
const PLAYABLE_EXTENSIONS: Record<Exclude<MediaNodeKind, "file">, Set<string>> = {
  video: new Set([".mp4", ".m4v", ".mov", ".ogv", ".webm"]),
  audio: new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".webm"]),
};

export class MediaNodeStoreError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function validUploadId(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

function validCoverKey(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

function cleanOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function isKind(value: unknown): value is MediaNodeKind {
  return value === "video" || value === "audio" || value === "file";
}

function displayFileName(value: string): string | null {
  const fileName = path.basename(value.trim()).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
  return fileName || null;
}

function safeEqual(left: string, right: string): boolean {
  try {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || !["EEXIST", "EPERM"].includes(String(error.code))) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
  }
}

function decodeCursor(value: string | null, snapshotCreatedAt: number): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { version?: number; offset?: number };
    return parsed.version === snapshotCreatedAt && Number.isInteger(parsed.offset) && parsed.offset! >= 0
      ? parsed.offset!
      : 0;
  } catch {
    return 0;
  }
}

function encodeCursor(snapshotCreatedAt: number, offset: number): string {
  return Buffer.from(JSON.stringify({ version: snapshotCreatedAt, offset }), "utf8").toString("base64url");
}

export class MediaNodeStore {
  readonly root: string;
  private manifestSnapshot?: ManifestSnapshot;
  private readonly sessions = new Map<string, UploadSession>();
  private readonly uploadLocks = new Map<string, Promise<void>>();
  private readonly durationJobs = new Map<string, Promise<number>>();
  private readonly thumbnailJobs = new Map<string, Promise<string>>();
  private readonly thumbnailQueue: Array<() => void> = [];
  private activeThumbnailJobs = 0;

  constructor(rootValue: string) {
    this.root = path.resolve(rootValue);
    this.ensureDirectories();
  }

  private ensureDirectories() {
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(path.join(this.root, ".covers"), { recursive: true });
    for (const kind of MEDIA_KINDS) {
      fs.mkdirSync(path.join(this.root, kind), { recursive: true });
    }
  }

  private sessionPath(uploadId: string): string {
    return path.join(this.root, ".uploads", `${uploadId}.session.json`);
  }

  private partialPath(uploadId: string): string {
    return path.join(this.root, ".uploads", `${uploadId}.part`);
  }

  private completedPath(uploadId: string): string {
    return path.join(this.root, ".uploads", `${uploadId}.complete.json`);
  }

  private mediaPath(storedName: string): string {
    const normalized = normalizeMediaStoragePath(storedName);
    if (!normalized || !isKind(normalized.split("/", 1)[0])) {
      throw new MediaNodeStoreError("资源路径无效");
    }
    try {
      return resolveMediaStoragePath(this.root, normalized);
    } catch {
      throw new MediaNodeStoreError("资源路径无效");
    }
  }

  private coverPath(key: string): string {
    if (!validCoverKey(key)) {
      throw new MediaNodeStoreError("封面标识无效");
    }
    return path.join(this.root, ".covers", `${key}.jpg`);
  }

  private readSession(uploadId: string): UploadSession {
    if (!validUploadId(uploadId)) {
      throw new MediaNodeStoreError("上传任务不存在", 404);
    }
    const cached = this.sessions.get(uploadId);
    if (cached) return cached;
    try {
      const session = JSON.parse(fs.readFileSync(this.sessionPath(uploadId), "utf8")) as UploadSession;
      if (session.id !== uploadId || !isKind(session.kind)) throw new Error("invalid session");
      this.sessions.set(uploadId, session);
      return session;
    } catch {
      throw new MediaNodeStoreError("上传任务不存在或已失效", 404);
    }
  }

  private withUploadLock<T>(uploadId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.uploadLocks.get(uploadId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    const settled = current.then(() => undefined, () => undefined);
    this.uploadLocks.set(uploadId, settled);
    return current.finally(() => {
      if (this.uploadLocks.get(uploadId) === settled) {
        this.uploadLocks.delete(uploadId);
      }
    });
  }

  private enqueueThumbnail<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        this.activeThumbnailJobs += 1;
        void task()
          .then(resolve, reject)
          .finally(() => {
            this.activeThumbnailJobs -= 1;
            this.thumbnailQueue.shift()?.();
          });
      };
      if (this.activeThumbnailJobs < THUMBNAIL_CONCURRENCY) {
        start();
      } else {
        this.thumbnailQueue.push(start);
      }
    });
  }

  private verifyUpload(uploadId: string, token: string, origin: string): UploadSession {
    const session = this.readSession(uploadId);
    if (!safeEqual(session.tokenHash, crypto.createHash("sha256").update(token).digest("hex"))) {
      throw new MediaNodeStoreError("上传凭证无效", 401);
    }
    if (!origin || origin !== session.allowedOrigin) {
      throw new MediaNodeStoreError("上传来源无效", 403);
    }
    return session;
  }

  getUploadOrigin(uploadId: string): string | null {
    try {
      return this.readSession(uploadId).allowedOrigin;
    } catch {
      return null;
    }
  }

  authorizeUpload(uploadId: string, token: string, origin: string) {
    this.verifyUpload(uploadId, token, origin);
  }

  pruneStaleUploads(now = Date.now()) {
    const directory = path.join(this.root, ".uploads");
    if (!fs.existsSync(directory)) return;
    for (const fileName of fs.readdirSync(directory)) {
      if (!fileName.endsWith(".session.json") && !fileName.endsWith(".complete.json")) continue;
      const filePath = path.join(directory, fileName);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs <= MEDIA_UPLOAD_SESSION_TTL_MS) continue;
        const uploadId = fileName.slice(0, fileName.indexOf("."));
        if (this.uploadLocks.has(uploadId)) continue;
        fs.rmSync(filePath, { force: true });
        if (fileName.endsWith(".session.json")) {
          fs.rmSync(this.partialPath(uploadId), { force: true });
          this.sessions.delete(uploadId);
        }
      } catch {
        // A concurrent upload may have completed while stale sessions were pruned.
      }
    }
  }

  startUpload(request: MediaNodeUploadRequest): MediaNodeUploadStart {
    if (
      !isKind(request.kind) ||
      !Number.isInteger(request.sizeBytes) ||
      request.sizeBytes <= 0 ||
      request.sizeBytes > MEDIA_UPLOAD_MAX_BYTES
    ) {
      throw new MediaNodeStoreError("上传文件大小无效");
    }
    const storedName = normalizeMediaStoragePath(request.storedName);
    const allowedOrigin = cleanOrigin(request.allowedOrigin);
    if (!storedName || !storedName.startsWith(`${request.kind}/`) || !allowedOrigin) {
      throw new MediaNodeStoreError("上传目标无效");
    }
    const extension = path.posix.extname(storedName).toLowerCase();
    const conversionSource = request.kind === "video" && getActiveVideoTranscodeProfile() &&
      [".ts", ".mts", ".m2ts"].includes(extension);
    if (request.kind !== "file" && !PLAYABLE_EXTENSIONS[request.kind].has(extension) && !conversionSource) {
      throw new MediaNodeStoreError("媒体格式不受支持");
    }
    const parentPath = path.dirname(this.mediaPath(storedName));
    if (!fs.existsSync(parentPath) || !fs.statSync(parentPath).isDirectory()) {
      throw new MediaNodeStoreError("上传目标文件夹不存在", 404);
    }
    fs.mkdirSync(path.join(this.root, ".uploads"), { recursive: true });
    this.pruneStaleUploads();
    const uploadId = crypto.randomBytes(16).toString("hex");
    const uploadToken = crypto.randomBytes(32).toString("base64url");
    const session: UploadSession = {
      ...request,
      storedName,
      allowedOrigin,
      id: uploadId,
      tokenHash: crypto.createHash("sha256").update(uploadToken).digest("hex"),
      createdAt: Date.now(),
    };
    writeJsonAtomic(this.sessionPath(uploadId), session);
    fs.writeFileSync(this.partialPath(uploadId), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    this.sessions.set(uploadId, session);
    return { uploadId, uploadToken, chunkBytes: MEDIA_UPLOAD_CHUNK_BYTES };
  }

  uploadStatus(uploadId: string, token: string, origin: string): Promise<number> {
    return this.withUploadLock(uploadId, async () => {
      this.verifyUpload(uploadId, token, origin);
      try {
        return (await fs.promises.stat(this.partialPath(uploadId))).size;
      } catch {
        throw new MediaNodeStoreError("上传任务不存在或已完成", 404);
      }
    });
  }

  appendUploadChunk(
    uploadId: string,
    token: string,
    origin: string,
    offset: number,
    buffer: Buffer,
  ): Promise<number> {
    return this.withUploadLock(uploadId, async () => {
      const session = this.verifyUpload(uploadId, token, origin);
      if (!Number.isInteger(offset) || offset < 0 || buffer.length <= 0 || buffer.length > MEDIA_UPLOAD_CHUNK_BYTES) {
        throw new MediaNodeStoreError("上传分片无效");
      }
      let handle: fs.promises.FileHandle;
      try {
        handle = await fs.promises.open(this.partialPath(uploadId), "r+");
      } catch {
        throw new MediaNodeStoreError("上传任务不存在或已完成", 404);
      }
      try {
        const currentSize = (await handle.stat()).size;
        if (currentSize !== offset) {
          throw new MediaNodeStoreError(`上传位置已变化:${currentSize}`, 409);
        }
        if (currentSize + buffer.length > session.sizeBytes) {
          throw new MediaNodeStoreError("上传内容超过原文件大小");
        }
        const result = await handle.write(buffer, 0, buffer.length, currentSize);
        if (result.bytesWritten !== buffer.length) {
          throw new MediaNodeStoreError("上传分片写入不完整", 500);
        }
        void fs.promises.utimes(this.sessionPath(uploadId), new Date(), new Date()).catch(() => undefined);
        return currentSize + result.bytesWritten;
      } finally {
        await handle.close();
      }
    });
  }

  private availableStoredName(requestedStoredName: string): string {
    const extension = path.posix.extname(requestedStoredName);
    const base = requestedStoredName.slice(0, -extension.length);
    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const candidate = suffix === 1 ? requestedStoredName : `${base} (${suffix})${extension}`;
      if (!fs.existsSync(this.mediaPath(candidate))) return candidate;
    }
    throw new MediaNodeStoreError("同名资源过多，请修改名称", 409);
  }

  async finishUpload(uploadId: string): Promise<MediaNodeUploadReceipt> {
    return this.withUploadLock(uploadId, () => this.finishUploadUnlocked(uploadId));
  }

  private async finishUploadUnlocked(uploadId: string): Promise<MediaNodeUploadReceipt> {
    if (!validUploadId(uploadId)) {
      throw new MediaNodeStoreError("上传任务不存在", 404);
    }
    try {
      return JSON.parse(fs.readFileSync(this.completedPath(uploadId), "utf8")) as MediaNodeUploadReceipt;
    } catch {
      // Continue an unfinished commit.
    }
    const session = this.readSession(uploadId);
    const sourcePath = this.partialPath(uploadId);
    if (fs.existsSync(sourcePath) && fs.statSync(sourcePath).size !== session.sizeBytes) {
      throw new MediaNodeStoreError("文件尚未上传完成", 409);
    }
    const transcodeProfile = session.kind === "video" ? getActiveVideoTranscodeProfile() : null;
    const requestedStoredName = transcodeProfile
      ? videoTranscodeOutputStoredName(session.storedName, transcodeProfile)
      : session.storedName;
    const finalStoredName = session.finalStoredName || this.availableStoredName(requestedStoredName);
    if (!session.finalStoredName) {
      session.finalStoredName = finalStoredName;
      writeJsonAtomic(this.sessionPath(uploadId), session);
    }
    const finalPath = this.mediaPath(finalStoredName);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    if (fs.existsSync(sourcePath)) {
      if (transcodeProfile) {
        try {
          await transcodeVideoToProfile(
            sourcePath,
            finalPath,
            transcodeProfile,
            path.posix.extname(session.storedName),
          );
        } catch (error) {
          throw new MediaNodeStoreError(
            error instanceof Error ? `视频兼容处理失败：${error.message}` : "视频兼容处理失败",
            422,
          );
        }
      } else if (session.kind === "video") {
        try {
          await optimizeMediaFileFastStart(sourcePath, path.posix.extname(finalStoredName));
        } catch (error) {
          throw new MediaNodeStoreError(
            error instanceof Error ? `视频渐进播放优化失败：${error.message}` : "视频渐进播放优化失败",
            422,
          );
        }
      }
      if (!transcodeProfile) fs.renameSync(sourcePath, finalPath);
    } else if (!fs.existsSync(finalPath)) {
      throw new MediaNodeStoreError("上传文件不存在", 404);
    }
    const stat = fs.statSync(finalPath);
    const fileName = path.posix.basename(finalStoredName);
    const receipt: MediaNodeUploadReceipt = {
      uploadId,
      kind: session.kind,
      categoryId: session.categoryId,
      title: path.posix.basename(fileName, path.posix.extname(fileName)),
      artist: session.artist,
      description: session.description,
      fileName,
      storedName: finalStoredName,
      mimeType: transcodeProfile?.mimeType || session.mimeType,
      sizeBytes: stat.size,
      mtimeMs: Math.floor(stat.mtimeMs),
      durationSeconds: null,
    };
    writeJsonAtomic(this.completedPath(uploadId), receipt);
    fs.rmSync(this.sessionPath(uploadId), { force: true });
    this.sessions.delete(uploadId);
    this.invalidateManifest();
    return receipt;
  }

  cancelUpload(uploadId: string): Promise<boolean> {
    return this.withUploadLock(uploadId, async () => {
      if (!validUploadId(uploadId) || fs.existsSync(this.completedPath(uploadId))) return false;
      let session: UploadSession | null = null;
      try {
        session = this.readSession(uploadId);
      } catch {
        // Missing sessions still allow stale partial cleanup.
      }
      const found = Boolean(session) || fs.existsSync(this.partialPath(uploadId));
      fs.rmSync(this.sessionPath(uploadId), { force: true });
      fs.rmSync(this.partialPath(uploadId), { force: true });
      this.sessions.delete(uploadId);
      if (session?.finalStoredName) {
        fs.rmSync(this.mediaPath(session.finalStoredName), { force: true });
      }
      this.invalidateManifest();
      return found;
    });
  }

  private async scanManifest(): Promise<ManifestSnapshot> {
    const files: MediaNodeManifestFile[] = [];
    const folders: MediaNodeManifestFolder[] = [];
    const visit = async (kind: MediaNodeKind, directory: string, relativeFolder = "") => {
      for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || isIgnoredMediaStorageEntry(entry.name)) continue;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          const folderPath = [relativeFolder, entry.name].filter(Boolean).join("/");
          if (!normalizeMediaStoragePath(folderPath)) continue;
          const stat = await fs.promises.stat(absolutePath);
          folders.push({ kind, path: folderPath, mtimeMs: Math.floor(stat.mtimeMs) });
          await visit(kind, absolutePath, folderPath);
          continue;
        }
        if (!entry.isFile()) continue;
        const fileName = displayFileName(entry.name);
        if (!fileName) continue;
        const extension = path.extname(fileName).toLowerCase();
        if (kind !== "file" && !PLAYABLE_EXTENSIONS[kind].has(extension)) continue;
        const stat = await fs.promises.stat(absolutePath);
        const storedName = [kind, relativeFolder, entry.name].filter(Boolean).join("/");
        if (!normalizeMediaStoragePath(storedName)) continue;
        files.push({
          kind,
          fileName,
          storedName,
          mimeType: MIME_TYPES[extension] || "application/octet-stream",
          sizeBytes: stat.size,
          mtimeMs: Math.floor(stat.mtimeMs),
        });
      }
    };
    for (const kind of MEDIA_KINDS) {
      await visit(kind, path.join(this.root, kind));
    }
    const entries: ManifestSnapshot["entries"] = [
      ...files.map((value) => ({ type: "file" as const, value })),
      ...folders.map((value) => ({ type: "folder" as const, value })),
    ].sort((left, right) => {
      const leftKey = left.type === "file" ? `f:${left.value.storedName}` : `d:${left.value.kind}/${left.value.path}`;
      const rightKey = right.type === "file" ? `f:${right.value.storedName}` : `d:${right.value.kind}/${right.value.path}`;
      return leftKey.localeCompare(rightKey, "en");
    });
    return { createdAt: Date.now(), entries };
  }

  invalidateManifest() {
    delete this.manifestSnapshot;
  }

  async manifestPage(params: { cursor?: string | null; limit?: number; refresh?: boolean }): Promise<MediaNodeManifestPage> {
    if (
      params.refresh ||
      !this.manifestSnapshot ||
      Date.now() - this.manifestSnapshot.createdAt > MANIFEST_CACHE_MS
    ) {
      this.manifestSnapshot = await this.scanManifest();
    }
    const snapshot = this.manifestSnapshot;
    const offset = decodeCursor(params.cursor || null, snapshot.createdAt);
    const limit = Math.min(Math.max(Math.floor(params.limit || 1_000), 100), 2_000);
    const pageEntries = snapshot.entries.slice(offset, offset + limit);
    const nextOffset = offset + pageEntries.length;
    return {
      files: pageEntries.flatMap((entry) => entry.type === "file" ? [entry.value] : []),
      folders: pageEntries.flatMap((entry) => entry.type === "folder" ? [entry.value] : []),
      nextCursor: nextOffset < snapshot.entries.length ? encodeCursor(snapshot.createdAt, nextOffset) : null,
    };
  }

  createFolder(kind: MediaNodeKind, folderValue: string): string {
    if (!isKind(kind)) throw new MediaNodeStoreError("资源类型无效");
    const folder = normalizeMediaStoragePath(folderValue);
    if (!folder) throw new MediaNodeStoreError("文件夹路径无效");
    const target = this.mediaPath(`${kind}/${folder}`);
    const parent = path.dirname(target);
    if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
      throw new MediaNodeStoreError("上级文件夹不存在", 404);
    }
    if (fs.existsSync(target)) throw new MediaNodeStoreError("文件夹已存在", 409);
    fs.mkdirSync(target);
    this.invalidateManifest();
    return folder;
  }

  renameFolder(kind: MediaNodeKind, folderValue: string, nextFolderValue: string): string {
    if (!isKind(kind)) throw new MediaNodeStoreError("资源类型无效");
    const folder = normalizeMediaStoragePath(folderValue);
    const nextFolder = normalizeMediaStoragePath(nextFolderValue);
    if (!folder || !nextFolder) throw new MediaNodeStoreError("文件夹路径无效");
    const source = this.mediaPath(`${kind}/${folder}`);
    const target = this.mediaPath(`${kind}/${nextFolder}`);
    if (!fs.existsSync(source)) throw new MediaNodeStoreError("文件夹不存在", 404);
    if (fs.existsSync(target)) throw new MediaNodeStoreError("同名文件夹已存在", 409);
    if (!fs.existsSync(path.dirname(target))) throw new MediaNodeStoreError("上级文件夹不存在", 404);
    fs.renameSync(source, target);
    this.invalidateManifest();
    return nextFolder;
  }

  deleteFolder(kind: MediaNodeKind, folderValue: string): boolean {
    if (!isKind(kind)) throw new MediaNodeStoreError("资源类型无效");
    const folder = normalizeMediaStoragePath(folderValue);
    if (!folder) throw new MediaNodeStoreError("不能删除分类根目录");
    const target = this.mediaPath(`${kind}/${folder}`);
    if (!fs.existsSync(target)) return false;
    if (fs.readdirSync(target).length) throw new MediaNodeStoreError("只能删除空文件夹", 409);
    fs.rmdirSync(target);
    this.invalidateManifest();
    return true;
  }

  moveAsset(sourceValue: string, targetValue: string): boolean {
    const sourceStoredName = normalizeMediaStoragePath(sourceValue);
    const targetStoredName = normalizeMediaStoragePath(targetValue);
    if (!sourceStoredName || !targetStoredName) throw new MediaNodeStoreError("资源路径无效");
    const sourceKind = sourceStoredName.split("/", 1)[0];
    const targetKind = targetStoredName.split("/", 1)[0];
    if (!isKind(sourceKind) || sourceKind !== targetKind) {
      throw new MediaNodeStoreError("资源不能跨类型移动");
    }
    if (sourceStoredName === targetStoredName) return true;
    const source = this.mediaPath(sourceStoredName);
    const target = this.mediaPath(targetStoredName);
    if (!fs.existsSync(source)) throw new MediaNodeStoreError("资源文件不存在", 404);
    if (!fs.existsSync(path.dirname(target))) throw new MediaNodeStoreError("目标文件夹不存在", 404);
    const samePathIgnoringCase = source.toLowerCase() === target.toLowerCase();
    if (fs.existsSync(target) && !samePathIgnoringCase) {
      throw new MediaNodeStoreError("目标文件夹存在同名文件", 409);
    }
    if (samePathIgnoringCase) {
      const temporary = `${source}.${crypto.randomBytes(6).toString("hex")}.rename`;
      fs.renameSync(source, temporary);
      try {
        fs.renameSync(temporary, target);
      } catch (error) {
        fs.renameSync(temporary, source);
        throw error;
      }
    } else {
      fs.renameSync(source, target);
    }
    this.invalidateManifest();
    return true;
  }

  deleteAssets(storedNames: string[]): {
    deletedStoredNames: string[];
    failedStoredNames: string[];
  } {
    const deletedStoredNames: string[] = [];
    const failedStoredNames: string[] = [];
    for (const value of Array.from(new Set(storedNames)).slice(0, 500)) {
      const storedName = normalizeMediaStoragePath(value);
      if (!storedName || !isKind(storedName.split("/", 1)[0])) {
        failedStoredNames.push(value);
        continue;
      }
      try {
        fs.rmSync(this.mediaPath(storedName), { force: true });
        deletedStoredNames.push(storedName);
      } catch {
        failedStoredNames.push(storedName);
      }
    }
    this.invalidateManifest();
    return { deletedStoredNames, failedStoredNames };
  }

  async probeDuration(
    storedNameValue: string,
    expected?: { mtimeMs: number; sizeBytes: number },
  ): Promise<number> {
    const storedName = normalizeMediaStoragePath(storedNameValue);
    if (!storedName) throw new MediaNodeStoreError("资源路径无效");
    try {
      const sourcePath = this.mediaPath(storedName);
      const stat = await fs.promises.stat(sourcePath);
      if (
        expected &&
        (stat.size !== Math.floor(expected.sizeBytes) ||
          Math.floor(stat.mtimeMs) !== Math.floor(expected.mtimeMs))
      ) {
        throw new MediaNodeStoreError("资源版本已变化", 409);
      }
      const cacheIdentity = `${storedName}:${Math.floor(stat.mtimeMs)}:${stat.size}`;
      const existingJob = this.durationJobs.get(cacheIdentity);
      if (existingJob) return existingJob;
      const job = probeMediaDurationFile(sourcePath);
      this.durationJobs.set(cacheIdentity, job);
      try {
        return await job;
      } finally {
        if (this.durationJobs.get(cacheIdentity) === job) {
          this.durationJobs.delete(cacheIdentity);
        }
      }
    } catch (error) {
      if (error instanceof MediaNodeStoreError) throw error;
      throw new MediaNodeStoreError("无法读取媒体时长", 422);
    }
  }

  private thumbnailPaths(params: MediaThumbnailRequest): {
    sourcePath: string;
    sourceStat: fs.Stats;
    targetPath: string;
  } {
    const sourcePath = this.mediaPath(params.storedName);
    let sourceStat: fs.Stats;
    try {
      sourceStat = fs.statSync(sourcePath);
    } catch {
      throw new MediaNodeStoreError("资源不存在", 404);
    }
    if (
      !sourceStat.isFile() ||
      sourceStat.size !== params.sizeBytes ||
      Math.floor(sourceStat.mtimeMs) !== Math.floor(params.mtimeMs)
    ) {
      throw new MediaNodeStoreError("资源版本已变化", 404);
    }
    const cacheIdentity = crypto
      .createHash("sha256")
      .update(`${params.storedName}\n${Math.floor(params.mtimeMs)}\n${params.sizeBytes}\n${params.percent}`)
      .digest("hex");
    const targetPath = path.join(this.root, ".thumbnails", `${cacheIdentity}.jpg`);
    return { sourcePath, sourceStat, targetPath };
  }

  async findThumbnail(params: MediaThumbnailRequest): Promise<string | null> {
    const { sourceStat, targetPath } = this.thumbnailPaths(params);
    try {
      const thumbnailStat = await fs.promises.stat(targetPath);
      return thumbnailStat.size > 0 && thumbnailStat.mtimeMs >= sourceStat.mtimeMs ? targetPath : null;
    } catch {
      return null;
    }
  }

  async thumbnail(params: MediaThumbnailRequest): Promise<string> {
    const readyThumbnail = await this.findThumbnail(params);
    if (readyThumbnail) return readyThumbnail;
    const { sourcePath, sourceStat, targetPath } = this.thumbnailPaths(params);
    const cacheIdentity = path.basename(targetPath, ".jpg");
    const existingJob = this.thumbnailJobs.get(cacheIdentity);
    if (existingJob) return existingJob;
    const job = this.enqueueThumbnail(async () => {
      try {
        const thumbnailStat = await fs.promises.stat(targetPath);
        if (thumbnailStat.size > 0 && thumbnailStat.mtimeMs >= sourceStat.mtimeMs) return targetPath;
      } catch {
        // Another queued request has not generated the thumbnail yet.
      }
      const durationSeconds =
        Number.isFinite(params.durationSeconds) && Number(params.durationSeconds) > 0
          ? Number(params.durationSeconds)
          : await this.probeDuration(params.storedName, {
              mtimeMs: params.mtimeMs,
              sizeBytes: params.sizeBytes,
            });
      return generateVideoThumbnailFile({
        sourcePath,
        targetPath,
        durationSeconds,
        fraction: params.percent / 100,
      });
    });
    this.thumbnailJobs.set(cacheIdentity, job);
    void job.finally(() => this.thumbnailJobs.delete(cacheIdentity)).catch(() => undefined);
    return job;
  }

  clearThumbnails(): number {
    const directory = path.join(this.root, ".thumbnails");
    if (!fs.existsSync(directory)) return 0;
    let removed = 0;
    for (const fileName of fs.readdirSync(directory)) {
      if (!fileName.endsWith(".jpg")) continue;
      fs.rmSync(path.join(directory, fileName), { force: true });
      removed += 1;
    }
    return removed;
  }

  async writeCover(key: string, buffer: Buffer): Promise<void> {
    if (
      buffer.length <= 0 ||
      buffer.length > MAX_NORMALIZED_COVER_BYTES ||
      buffer[0] !== 0xff ||
      buffer[1] !== 0xd8
    ) {
      throw new MediaNodeStoreError("封面文件无效", 422);
    }
    const targetPath = this.coverPath(key);
    const temporaryPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    try {
      await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
      await fs.promises.rename(temporaryPath, targetPath);
    } finally {
      await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async findCover(key: string): Promise<string | null> {
    const targetPath = this.coverPath(key);
    try {
      const stat = await fs.promises.stat(targetPath);
      return stat.isFile() && stat.size > 0 ? targetPath : null;
    } catch {
      return null;
    }
  }

  deleteCover(key: string): boolean {
    const targetPath = this.coverPath(key);
    const found = fs.existsSync(targetPath);
    fs.rmSync(targetPath, { force: true });
    return found;
  }
}
