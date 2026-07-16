import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import {
  getMediaAsset,
  isMediaKindAccessible,
  mediaFilePath,
  normalizeMediaFolder,
  parseMediaByteRange,
  type MediaAsset,
} from "./media";

export type ResolvedMediaDelivery = {
  asset: MediaAsset;
  download: boolean;
};

function encodedStoredName(storedName: string): string {
  return storedName.split("/").map(encodeURIComponent).join("/");
}

function contentDisposition(asset: MediaAsset, download: boolean): string {
  const fallback = asset.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const mode = download ? "attachment" : "inline";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`;
}

export function mediaDeliveryUrl(asset: MediaAsset, download = false): string {
  const params = new URLSearchParams({ id: String(asset.id), v: String(Math.floor(asset.mtimeMs)) });
  if (download) {
    params.set("download", "1");
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
  if ((asset.kind === "file") !== download) {
    return null;
  }
  return { asset, download };
}

export function mediaDeliveryHeaders(delivery: ResolvedMediaDelivery): Headers {
  return new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": contentDisposition(delivery.asset, delivery.download),
    "X-Content-Type-Options": "nosniff",
    Vary: "Cookie",
  });
}

export function authorizeMediaDelivery(delivery: ResolvedMediaDelivery, authenticated: boolean): boolean {
  return isMediaKindAccessible(delivery.asset.kind, authenticated);
}

export async function serveMediaDelivery(request: NextRequest, delivery: ResolvedMediaDelivery): Promise<Response> {
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
  const headers = mediaDeliveryHeaders(delivery);
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
