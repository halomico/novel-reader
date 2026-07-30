import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getMediaDir } from "./config";
import { getDb } from "./db";
import {
  cancelRemoteMediaUpload,
  createRemoteMediaFolder,
  finishRemoteMediaUpload,
  MediaNodeClientError,
  startRemoteMediaUpload,
} from "./media-node-client";
import { MEDIA_UPLOAD_CHUNK_BYTES, MEDIA_UPLOAD_MAX_BYTES } from "./media-node-protocol";
import {
  getRemoteMediaNodeForKind,
  isRemoteMediaStorage,
} from "./media-storage-config";
import { resolveMediaStoragePath } from "./media-storage-path";
import { MarketError, type MarketAsset } from "./market";

type LocalMarketUpload = {
  id: string;
  productId: number;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
};

export type MarketUploadStart = {
  uploadId: string;
  uploadUrl: string;
  uploadToken?: string;
  chunkBytes: number;
};

const REMOTE_HANDLE = /^(\d+)~([a-z0-9][a-z0-9_-]{0,31})~([a-f0-9]{32})$/;
const LOCAL_UPLOAD_ID = /^[a-f0-9]{32}$/;
const uploadLocks = new Map<string, Promise<void>>();

function marketUploadDir(): string {
  return path.join(getMediaDir(), ".market-uploads");
}

function localSessionPath(uploadId: string): string {
  return path.join(marketUploadDir(), `${uploadId}.json`);
}

function localPartialPath(uploadId: string): string {
  return path.join(marketUploadDir(), `${uploadId}.part`);
}

function safeFileName(value: string): string {
  const base = path.basename(value.trim()).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_").slice(0, 180);
  return base && base !== "." && base !== ".." ? base : "download.bin";
}

function normalizedMime(value: string): string {
  const mime = value.trim().toLocaleLowerCase("en-US");
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "application/octet-stream";
}

function marketStoredName(productId: number, fileName: string): string {
  return `file/.market/${productId}/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${fileName}`;
}

function writeJsonAtomic(filePath: string, value: unknown) {
  const temporary = `${filePath}.${crypto.randomBytes(5).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function readLocalSession(uploadId: string): LocalMarketUpload {
  if (!LOCAL_UPLOAD_ID.test(uploadId)) {
    throw new MarketError("上传任务不存在", "not_found");
  }
  try {
    const session = JSON.parse(fs.readFileSync(localSessionPath(uploadId), "utf8")) as LocalMarketUpload;
    if (session.id !== uploadId || !Number.isInteger(session.productId)) throw new Error("invalid");
    return session;
  } catch {
    throw new MarketError("上传任务不存在或已失效", "not_found");
  }
}

function withUploadLock<T>(uploadId: string, task: () => Promise<T>): Promise<T> {
  const previous = uploadLocks.get(uploadId) || Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  const settled = current.then(() => undefined, () => undefined);
  uploadLocks.set(uploadId, settled);
  return current.finally(() => {
    if (uploadLocks.get(uploadId) === settled) uploadLocks.delete(uploadId);
  });
}

function productExists(productId: number): boolean {
  return Boolean(getDb().prepare("SELECT 1 AS found FROM market_products WHERE id = ?").get(productId));
}

async function ensureRemoteMarketFolder(nodeId: string, productId: number) {
  for (const folder of [".market", `.market/${productId}`]) {
    try {
      await createRemoteMediaFolder(nodeId, "file", folder);
    } catch (error) {
      if (!(error instanceof MediaNodeClientError) || error.status !== 409) throw error;
    }
  }
}

function insertMarketAsset(input: {
  productId: number;
  storageNodeId: string | null;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
}): MarketAsset {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, product_id, storage_node_id, file_name, stored_name, mime_type, size_bytes, mtime_ms, created_at
       FROM market_assets
       WHERE storage_node_id IS ? AND stored_name = ?`,
    )
    .get(input.storageNodeId, input.storedName) as {
    id: number;
    product_id: number;
    storage_node_id: string | null;
    file_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    mtime_ms: number;
    created_at: string;
  } | undefined;
  if (existing) {
    return {
      id: existing.id,
      productId: existing.product_id,
      storageNodeId: existing.storage_node_id,
      fileName: existing.file_name,
      storedName: existing.stored_name,
      mimeType: existing.mime_type,
      sizeBytes: existing.size_bytes,
      mtimeMs: existing.mtime_ms,
      createdAt: existing.created_at,
    };
  }
  const info = db
    .prepare(
      `INSERT INTO market_assets (
         product_id, storage_node_id, file_name, stored_name, mime_type, size_bytes, mtime_ms
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.productId,
      input.storageNodeId,
      input.fileName,
      input.storedName,
      input.mimeType,
      input.sizeBytes,
      input.mtimeMs,
    );
  return {
    id: Number(info.lastInsertRowid),
    productId: input.productId,
    storageNodeId: input.storageNodeId,
    fileName: input.fileName,
    storedName: input.storedName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs,
    createdAt: new Date().toISOString(),
  };
}

export async function startMarketAssetUpload(input: {
  productId: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  allowedOrigin: string;
}): Promise<MarketUploadStart> {
  const productId = Math.floor(input.productId);
  const sizeBytes = Math.floor(input.sizeBytes);
  if (!Number.isInteger(productId) || productId < 1 || !productExists(productId)) {
    throw new MarketError("商品不存在", "not_found");
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > MEDIA_UPLOAD_MAX_BYTES) {
    throw new MarketError("文件大小无效", "invalid");
  }
  const fileName = safeFileName(input.fileName);
  const mimeType = normalizedMime(input.mimeType);
  const storedName = marketStoredName(productId, fileName);

  if (isRemoteMediaStorage()) {
    const node = getRemoteMediaNodeForKind("file");
    await ensureRemoteMarketFolder(node.id, productId);
    const started = await startRemoteMediaUpload(
      node.id,
      {
        kind: "file",
        categoryId: null,
        title: path.basename(fileName, path.extname(fileName)),
        artist: "",
        description: "",
        storedName,
        mimeType,
        sizeBytes,
      },
      input.allowedOrigin,
    );
    return {
      uploadId: `${productId}~${node.id}~${started.uploadId}`,
      uploadUrl: started.uploadUrl,
      uploadToken: started.uploadToken,
      chunkBytes: started.chunkBytes,
    };
  }

  const uploadId = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(marketUploadDir(), { recursive: true });
  fs.mkdirSync(path.dirname(resolveMediaStoragePath(getMediaDir(), storedName)), { recursive: true });
  const session: LocalMarketUpload = {
    id: uploadId,
    productId,
    fileName,
    storedName,
    mimeType,
    sizeBytes,
  };
  writeJsonAtomic(localSessionPath(uploadId), session);
  fs.writeFileSync(localPartialPath(uploadId), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  return {
    uploadId,
    uploadUrl: `/admin/market/upload?action=chunk&uploadId=${uploadId}`,
    chunkBytes: MEDIA_UPLOAD_CHUNK_BYTES,
  };
}

export function appendMarketAssetUploadChunk(uploadId: string, offset: number, buffer: Buffer): Promise<number> {
  return withUploadLock(uploadId, async () => {
    const session = readLocalSession(uploadId);
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      buffer.length <= 0 ||
      buffer.length > MEDIA_UPLOAD_CHUNK_BYTES
    ) {
      throw new MarketError("上传分片无效", "invalid");
    }
    const handle = await fs.promises.open(localPartialPath(uploadId), "r+");
    try {
      const currentSize = (await handle.stat()).size;
      if (currentSize !== offset) throw new MarketError(`上传位置已变化:${currentSize}`, "invalid");
      if (currentSize + buffer.length > session.sizeBytes) {
        throw new MarketError("上传内容超过原文件大小", "invalid");
      }
      const result = await handle.write(buffer, 0, buffer.length, currentSize);
      return currentSize + result.bytesWritten;
    } finally {
      await handle.close();
    }
  });
}

export function getMarketAssetUploadOffset(uploadId: string): Promise<number> {
  return withUploadLock(uploadId, async () => {
    readLocalSession(uploadId);
    return (await fs.promises.stat(localPartialPath(uploadId))).size;
  });
}

export async function finishMarketAssetUpload(uploadId: string): Promise<MarketAsset> {
  const remote = REMOTE_HANDLE.exec(uploadId);
  if (remote) {
    const productId = Number(remote[1]);
    const receipt = await finishRemoteMediaUpload(remote[2], remote[3]);
    return insertMarketAsset({
      productId,
      storageNodeId: remote[2],
      fileName: receipt.fileName,
      storedName: receipt.storedName,
      mimeType: receipt.mimeType,
      sizeBytes: receipt.sizeBytes,
      mtimeMs: receipt.mtimeMs,
    });
  }
  return withUploadLock(uploadId, async () => {
    const session = readLocalSession(uploadId);
    const partialPath = localPartialPath(uploadId);
    const stat = await fs.promises.stat(partialPath);
    if (stat.size !== session.sizeBytes) {
      throw new MarketError("文件尚未上传完成", "invalid");
    }
    const finalPath = resolveMediaStoragePath(getMediaDir(), session.storedName);
    await fs.promises.rename(partialPath, finalPath);
    const finalStat = await fs.promises.stat(finalPath);
    fs.rmSync(localSessionPath(uploadId), { force: true });
    return insertMarketAsset({
      productId: session.productId,
      storageNodeId: null,
      fileName: session.fileName,
      storedName: session.storedName,
      mimeType: session.mimeType,
      sizeBytes: finalStat.size,
      mtimeMs: Math.floor(finalStat.mtimeMs),
    });
  });
}

export async function cancelMarketAssetUpload(uploadId: string): Promise<boolean> {
  const remote = REMOTE_HANDLE.exec(uploadId);
  if (remote) {
    return cancelRemoteMediaUpload(remote[2], remote[3]);
  }
  if (!LOCAL_UPLOAD_ID.test(uploadId)) return false;
  const found = fs.existsSync(localSessionPath(uploadId)) || fs.existsSync(localPartialPath(uploadId));
  fs.rmSync(localSessionPath(uploadId), { force: true });
  fs.rmSync(localPartialPath(uploadId), { force: true });
  return found;
}
