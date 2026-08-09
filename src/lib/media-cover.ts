import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getMediaDir } from "./config";
import { deleteRemoteMediaCover, writeRemoteMediaCover } from "./media-node-client";
import { isRemoteMediaStorage, resolveRemoteMediaNodeForAsset } from "./media-storage-config";
import type { MediaAsset } from "./media";

export const MAX_CUSTOM_MEDIA_COVER_BYTES = 10 * 1024 * 1024;
const MAX_NORMALIZED_COVER_BYTES = 2 * 1024 * 1024;
const CUSTOM_COVER_WIDTH = 640;
const CUSTOM_COVER_HEIGHT = 360;

export class MediaCoverError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function validCoverKey(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

function localCoverPath(key: string): string {
  if (!validCoverKey(key)) {
    throw new MediaCoverError("封面标识无效");
  }
  return path.join(getMediaDir(), ".covers", `${key}.jpg`);
}

export function createMediaCoverKey(): string {
  return crypto.randomBytes(16).toString("hex");
}

export async function normalizeMediaCover(buffer: Buffer): Promise<Buffer> {
  if (buffer.length <= 0) {
    throw new MediaCoverError("请选择封面图片");
  }
  if (buffer.length > MAX_CUSTOM_MEDIA_COVER_BYTES) {
    throw new MediaCoverError("封面图片不能超过 10 MB", 413);
  }
  try {
    const normalized = await sharp(buffer, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize(CUSTOM_COVER_WIDTH, CUSTOM_COVER_HEIGHT, {
        fit: "cover",
        position: "centre",
      })
      .flatten({ background: "#111111" })
      .jpeg({
        quality: 84,
        chromaSubsampling: "4:2:0",
        mozjpeg: true,
      })
      .toBuffer();
    if (normalized.length <= 0 || normalized.length > MAX_NORMALIZED_COVER_BYTES) {
      throw new MediaCoverError("封面处理后体积异常", 422);
    }
    return normalized;
  } catch (error) {
    if (error instanceof MediaCoverError) throw error;
    throw new MediaCoverError("无法读取封面图片，请使用 JPG、PNG 或 WebP", 422);
  }
}

export async function writeMediaCustomCover(
  asset: Pick<MediaAsset, "kind" | "storageNodeId">,
  key: string,
  buffer: Buffer,
): Promise<void> {
  if (asset.kind !== "video") {
    throw new MediaCoverError("只有视频支持自定义封面");
  }
  if (isRemoteMediaStorage()) {
    const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
    await writeStoredCover(node.id, key, buffer);
    return;
  }
  await writeStoredCover(null, key, buffer);
}

export async function writeStoredCover(
  storageNodeId: string | null,
  key: string,
  buffer: Buffer,
): Promise<void> {
  if (storageNodeId) {
    await writeRemoteMediaCover(storageNodeId, key, buffer);
    return;
  }
  const targetPath = localCoverPath(key);
  const temporaryPath = `${targetPath}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.promises.writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
    await fs.promises.rename(temporaryPath, targetPath);
  } finally {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function deleteMediaCustomCover(
  asset: Pick<MediaAsset, "kind" | "storageNodeId">,
  key: string | null,
): Promise<boolean> {
  if (!key) return false;
  if (isRemoteMediaStorage()) {
    const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
    return deleteStoredCover(node.id, key);
  }
  return deleteStoredCover(null, key);
}

export async function deleteStoredCover(
  storageNodeId: string | null,
  key: string | null,
): Promise<boolean> {
  if (!key) return false;
  if (storageNodeId) {
    return deleteRemoteMediaCover(storageNodeId, key);
  }
  const targetPath = localCoverPath(key);
  const found = fs.existsSync(targetPath);
  await fs.promises.rm(targetPath, { force: true });
  return found;
}

export async function findLocalMediaCustomCover(key: string): Promise<string | null> {
  return findLocalStoredCover(key);
}

export async function findLocalStoredCover(key: string): Promise<string | null> {
  const targetPath = localCoverPath(key);
  try {
    const stat = await fs.promises.stat(targetPath);
    return stat.isFile() && stat.size > 0 ? targetPath : null;
  } catch {
    return null;
  }
}
