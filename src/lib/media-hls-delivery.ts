import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getMediaDir } from "./config";
import { parseMediaByteRange, type MediaAsset } from "./media";
import { createSignedMediaHlsFileUrl } from "./media-signing";
import {
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";
import {
  createPlaybackHlsFileStream,
  getPlaybackHlsFileSet,
} from "./video-hls";

export function mediaHlsVirtualFileName(asset: Pick<MediaAsset, "fileName" | "title">): string {
  const source = asset.fileName || asset.title || "video";
  const extension = path.extname(source);
  const stem = path.basename(source, extension).trim() || "video";
  return `${stem}.mp4`;
}

function contentDisposition(fileName: string, download: boolean): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function mediaHlsFileUrl(asset: MediaAsset, download: boolean): string {
  if (!asset.playbackManifestPath) throw new Error("HLS 播放成品不存在");
  if (isRemoteMediaStorage()) {
    return createSignedMediaHlsFileUrl({
      storageNodeId: resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind).id,
      manifestPath: asset.playbackManifestPath,
      fileName: mediaHlsVirtualFileName(asset),
      download,
    });
  }
  const params = new URLSearchParams({
    v: asset.playbackVersion,
    download: download ? "1" : "0",
  });
  return `/media/${asset.id}/hls/file?${params.toString()}`;
}

export async function serveLocalMediaHlsFile(
  request: NextRequest,
  asset: MediaAsset,
  download: boolean,
): Promise<Response> {
  if (!asset.playbackManifestPath || isRemoteMediaStorage()) {
    return new Response(null, { status: 404 });
  }
  let fileSet;
  try {
    fileSet = await getPlaybackHlsFileSet(getMediaDir(), asset.playbackManifestPath);
  } catch {
    return new Response(null, { status: 404 });
  }
  const etag = `"hls-file-${asset.id}-${asset.playbackVersion}-${fileSet.sizeBytes}"`;
  let rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  if (rangeHeader && ifRange && ifRange !== etag) rangeHeader = null;
  const range = parseMediaByteRange(rangeHeader, fileSet.sizeBytes);
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300, no-transform",
    "Content-Disposition": contentDisposition(mediaHlsVirtualFileName(asset), download),
    "Content-Type": "video/mp4",
    ETag: etag,
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
    "X-Media-Delivery": "hls-virtual-file",
  });
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${fileSet.sizeBytes}`);
    return new Response(null, { status: 416, headers });
  }
  if (!range && request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? fileSet.sizeBytes - 1;
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${fileSet.sizeBytes}`);
  if (request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const stream = createPlaybackHlsFileStream(fileSet, start, end);
  return new Response(
    Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    { status: range ? 206 : 200, headers },
  );
}
