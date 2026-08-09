import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import {
  getMediaAsset,
  isMediaKindConsumable,
  mediaFilePath,
  normalizeMediaFolder,
  parseMediaByteRange,
  type MediaAsset,
} from "./media";
import { createSignedMediaUrl } from "./media-signing";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";

export type ResolvedMediaDelivery = {
  asset: MediaAsset;
  download: boolean;
  downloadToken: string;
  playbackSessionId: string;
  playbackToken: string;
};

function encodedStoredName(storedName: string): string {
  return storedName.split("/").map(encodeURIComponent).join("/");
}

function contentDisposition(asset: MediaAsset, download: boolean): string {
  const fallback = asset.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const mode = download ? "attachment" : "inline";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`;
}

export function mediaDeliveryUrl(
  asset: MediaAsset,
  download = false,
  options: {
    publiclyAccessible?: boolean;
    estimatedKbps?: number;
    downloadToken?: string;
    playbackSessionId?: string;
    playbackToken?: string;
  } = {},
): string {
  if (isRemoteMediaStorage()) {
    const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
    return createSignedMediaUrl({
      storageNodeId: node.id,
      storedName: asset.storedName,
      mimeType: asset.mimeType,
      fileName: asset.fileName,
      mtimeMs: asset.mtimeMs,
      sizeBytes: asset.sizeBytes,
      download,
      publiclyAccessible: Boolean(options.publiclyAccessible),
      estimatedKbps: options.estimatedKbps,
    });
  }
  const params = new URLSearchParams({ id: String(asset.id), v: String(Math.floor(asset.mtimeMs)) });
  if (download) {
    params.set("download", "1");
    if (options.downloadToken) params.set("ticket", options.downloadToken);
  } else if (asset.kind === "video" && options.playbackSessionId && options.playbackToken) {
    params.set("ps", options.playbackSessionId);
    params.set("pt", options.playbackToken);
  }
  return `/media-file/${encodedStoredName(asset.storedName)}?${params.toString()}`;
}

export function resolveMediaDeliveryUri(uri: string): ResolvedMediaDelivery | null {
  let url: URL;
  try {
    url = new URL(uri, "http://media.local");
  } catch {
    return null;
  }
  const prefix = "/media-file/";
  if (!url.pathname.startsWith(prefix)) {
    return null;
  }

  let storedName: string;
  try {
    storedName = url.pathname
      .slice(prefix.length)
      .split("/")
      .map((segment) => decodeURIComponent(segment))
      .join("/");
  } catch {
    return null;
  }
  const normalizedStoredName = normalizeMediaFolder(storedName);
  const id = Number(url.searchParams.get("id"));
  const version = Number(url.searchParams.get("v"));
  const asset = getMediaAsset(id);
  if (
    !normalizedStoredName ||
    !asset ||
    asset.storedName !== normalizedStoredName ||
    !Number.isFinite(version) ||
    Math.floor(asset.mtimeMs) !== Math.floor(version)
  ) {
    return null;
  }
  const download = url.searchParams.get("download") === "1";
  if (download && asset.kind !== "file" && asset.kind !== "video") {
    return null;
  }
  const downloadToken = url.searchParams.get("ticket") || "";
  if (downloadToken && !/^[A-Za-z0-9_-]{32,128}$/u.test(downloadToken)) {
    return null;
  }
  const playbackSessionId = url.searchParams.get("ps") || "";
  const playbackToken = url.searchParams.get("pt") || "";
  if (playbackSessionId && !/^[A-Za-z0-9_-]{16,128}$/u.test(playbackSessionId)) return null;
  if (playbackToken && !/^[A-Za-z0-9_-]{32,128}$/u.test(playbackToken)) return null;
  return { asset, download, downloadToken, playbackSessionId, playbackToken };
}

export function mediaDeliveryHeaders(
  delivery: ResolvedMediaDelivery,
  publiclyAccessible = false,
): Headers {
  const headers = new Headers({
    "Cache-Control": publiclyAccessible
      ? "public, max-age=21600, immutable, no-transform"
      : "private, max-age=300, no-transform",
    "Content-Disposition": contentDisposition(delivery.asset, delivery.download),
    "X-Content-Type-Options": "nosniff",
  });
  if (publiclyAccessible) {
    headers.set("Cloudflare-CDN-Cache-Control", "public, max-age=21600, no-transform");
  } else {
    headers.set("Vary", "Cookie");
  }
  return headers;
}

export function authorizeMediaDelivery(delivery: ResolvedMediaDelivery, authenticated: boolean): boolean {
  return isMediaKindConsumable(delivery.asset.kind, authenticated);
}

export async function serveMediaDelivery(
  request: NextRequest,
  delivery: ResolvedMediaDelivery,
  options: { publiclyAccessible?: boolean } = {},
): Promise<Response> {
  if (isRemoteMediaStorage()) {
    return new Response(null, { status: 404 });
  }
  const filePath = mediaFilePath(delivery.asset.storedName);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!stat.isFile() || stat.size <= 0) {
    return new Response(null, { status: 404 });
  }

  const etag = `"media-${delivery.asset.id}-${Math.floor(stat.mtimeMs)}-${stat.size}"`;
  const lastModified = stat.mtime.toUTCString();
  let rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  if (rangeHeader && ifRange && ifRange !== etag && ifRange !== lastModified) {
    rangeHeader = null;
  }
  const range = parseMediaByteRange(rangeHeader, stat.size);
  if (range === "invalid") {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const headers = mediaDeliveryHeaders(delivery, Boolean(options.publiclyAccessible));
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Type", delivery.asset.mimeType);
  headers.set("ETag", etag);
  headers.set("Last-Modified", lastModified);
  headers.set("X-Media-Delivery", "next-fallback");
  if (range) {
    headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  } else if (request.headers.get("if-none-match") === etag) {
    headers.delete("Content-Length");
    return new Response(null, { status: 304, headers });
  }
  if (request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers });
}
