import fs from "node:fs";
import path from "node:path";
import iconv from "iconv-lite";
import { isUtf8 } from "node:buffer";
import { mediaDeliveryUrl } from "./media-delivery";
import { mediaFilePath, type MediaAsset } from "./media";
import { isRemoteMediaStorage } from "./media-storage-config";

export type MediaTextPreview = {
  format: "text" | "markdown";
  content: string;
  truncated: boolean;
};

type CachedPreview = {
  expiresAt: number;
  value: MediaTextPreview;
};

type PreviewGlobal = typeof globalThis & {
  mediaTextPreviewCache?: Map<string, CachedPreview>;
};

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_CACHE_ENTRIES = 80;

function previewFormat(asset: MediaAsset): "text" | "markdown" | null {
  const extension = path.extname(asset.fileName).toLocaleLowerCase("en-US");
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".txt") return "text";
  return null;
}

export function isMediaTextPreviewSupported(asset: MediaAsset): boolean {
  return asset.kind === "file" && previewFormat(asset) !== null;
}

function decodePreviewBuffer(buffer: Buffer): string {
  if (isUtf8(buffer)) {
    return buffer.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  }
  for (let trim = 1; trim <= Math.min(3, buffer.length); trim += 1) {
    const candidate = buffer.subarray(0, buffer.length - trim);
    if (isUtf8(candidate)) {
      return candidate.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    }
  }
  return iconv.decode(buffer, "gb18030").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function cache(): Map<string, CachedPreview> {
  const state = globalThis as PreviewGlobal;
  state.mediaTextPreviewCache ||= new Map();
  return state.mediaTextPreviewCache;
}

function cacheSet(key: string, value: MediaTextPreview) {
  const state = cache();
  state.delete(key);
  state.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  while (state.size > MAX_CACHE_ENTRIES) {
    const oldest = state.keys().next().value as string | undefined;
    if (!oldest) break;
    state.delete(oldest);
  }
}

async function readPreviewBytes(asset: MediaAsset): Promise<Buffer> {
  const end = Math.min(asset.sizeBytes, MAX_PREVIEW_BYTES) - 1;
  if (end < 0) return Buffer.alloc(0);
  if (!isRemoteMediaStorage() || !asset.storageNodeId) {
    const handle = await fs.promises.open(mediaFilePath(asset.storedName), "r");
    try {
      const buffer = Buffer.alloc(end + 1);
      const result = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, result.bytesRead);
    } finally {
      await handle.close();
    }
  }
  const response = await fetch(mediaDeliveryUrl(asset, false), {
    headers: { Range: `bytes=0-${end}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok && response.status !== 206) {
    throw new Error("文档读取失败");
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function getMediaTextPreview(asset: MediaAsset): Promise<MediaTextPreview | null> {
  if (asset.kind !== "file") return null;
  const format = previewFormat(asset);
  if (!format) return null;
  const key = `${asset.id}:${Math.floor(asset.mtimeMs)}:${asset.sizeBytes}`;
  const cached = cache().get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = {
    format,
    content: decodePreviewBuffer(await readPreviewBytes(asset)),
    truncated: asset.sizeBytes > MAX_PREVIEW_BYTES,
  } satisfies MediaTextPreview;
  cacheSet(key, value);
  return value;
}
