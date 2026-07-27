import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import { MEDIA_UPLOAD_CHUNK_BYTES, type MediaNodeKind, type MediaNodeUploadRequest } from "./media-node-protocol";
import { MediaNodeStore, MediaNodeStoreError } from "./media-node-store";
import { verifySignedMediaThumbnailUrl, verifySignedMediaUrl } from "./media-signing";
import { resolveMediaStoragePath } from "./media-storage-path";

export type MediaNodeServerOptions = {
  root: string;
  signingSecret: string;
  controlSecret: string;
};

type ByteRange = { start: number; end: number };

function safeEqual(left: string, right: string): boolean {
  try {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

function bearerToken(request: IncomingMessage): string {
  const header = request.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function controlAuthorized(request: IncomingMessage, secret: string): boolean {
  return safeEqual(bearerToken(request), secret);
}

function json(response: ServerResponse, status: number, value: unknown, extraHeaders: Record<string, string> = {}) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": String(body.length),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(body);
}

function empty(response: ServerResponse, status: number, headers: Record<string, string> = {}) {
  response.writeHead(status, headers);
  response.end();
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = Number(request.headers["content-length"] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new MediaNodeStoreError("请求内容过大", 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new MediaNodeStoreError("请求内容过大", 413);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, size);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const body = await readBody(request, 64 * 1024);
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new MediaNodeStoreError("请求格式无效");
  }
}

function parseRange(value: string | undefined, size: number): ByteRange | "invalid" | null {
  if (!value) return null;
  const match = value.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return "invalid";
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return "invalid";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}

function contentDisposition(fileName: string, download: boolean): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${download ? "attachment" : "inline"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function uploadCors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Headers": "authorization, content-type, x-upload-offset",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

async function serveSignedMedia(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  root: string,
  signingSecret: string,
) {
  const payload = verifySignedMediaUrl(url, Date.now(), signingSecret);
  if (!payload) {
    empty(response, 404);
    return;
  }
  if (!["video", "audio", "file"].includes(payload.storedName.split("/", 1)[0])) {
    empty(response, 404);
    return;
  }
  let filePath: string;
  try {
    filePath = resolveMediaStoragePath(root, payload.storedName);
  } catch {
    empty(response, 404);
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    empty(response, 404);
    return;
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size !== payload.sizeBytes) {
    empty(response, 404);
    return;
  }
  if (Math.floor(stat.mtimeMs) !== payload.mtimeMs) {
    empty(response, 404);
    return;
  }
  const etag = `"media-${Math.floor(stat.mtimeMs)}-${stat.size}"`;
  const lastModified = stat.mtime.toUTCString();
  let rangeHeader = request.headers.range;
  const ifRange = request.headers["if-range"];
  if (rangeHeader && ifRange && ifRange !== etag && ifRange !== lastModified) {
    rangeHeader = undefined;
  }
  const range = parseRange(rangeHeader, stat.size);
  if (range === "invalid") {
    empty(response, 416, { "Content-Range": `bytes */${stat.size}` });
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const publicMaxAge = Math.max(
    60,
    Math.min(86_400, payload.expiresAt - Math.floor(Date.now() / 1_000) - 30),
  );
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": payload.publiclyAccessible
      ? `public, max-age=${publicMaxAge}, immutable, no-transform`
      : "private, max-age=300, no-transform",
    "Content-Disposition": contentDisposition(payload.fileName, payload.download),
    "Content-Length": String(end - start + 1),
    "Content-Type": payload.mimeType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    ETag: etag,
    "Last-Modified": lastModified,
    "X-Content-Type-Options": "nosniff",
  };
  if (payload.publiclyAccessible) {
    headers["Cloudflare-CDN-Cache-Control"] = `public, max-age=${publicMaxAge}, no-transform`;
  }
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  if (!range && request.headers["if-none-match"] === etag) {
    delete headers["Content-Length"];
    empty(response, 304, headers);
    return;
  }
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  pipeline(fs.createReadStream(filePath, { start, end }), response, () => undefined);
}

async function serveSignedThumbnail(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  store: MediaNodeStore,
  signingSecret: string,
) {
  const payload = verifySignedMediaThumbnailUrl(url, Date.now(), signingSecret);
  if (!payload) {
    empty(response, 404);
    return;
  }
  try {
    const thumbnailPath = await store.findThumbnail(payload);
    if (!thumbnailPath) {
      empty(response, 404, { "Cache-Control": "no-store" });
      return;
    }
    const stat = fs.statSync(thumbnailPath);
    const etag = `"media-thumbnail-${path.basename(thumbnailPath, ".jpg")}-${stat.size}"`;
    const publicMaxAge = Math.max(
      60,
      Math.min(86_400, payload.expiresAt - Math.floor(Date.now() / 1_000) - 30),
    );
    const headers: Record<string, string> = {
      "Cache-Control": payload.publiclyAccessible
        ? `public, max-age=${publicMaxAge}, immutable`
        : "private, max-age=86400, stale-while-revalidate=604800, immutable",
      "Content-Length": String(stat.size),
      "Content-Type": "image/jpeg",
      "Cross-Origin-Resource-Policy": "cross-origin",
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      "X-Content-Type-Options": "nosniff",
    };
    if (payload.publiclyAccessible) {
      headers["Cloudflare-CDN-Cache-Control"] = `public, max-age=${publicMaxAge}, no-transform`;
    }
    if (request.headers["if-none-match"] === etag) {
      delete headers["Content-Length"];
      empty(response, 304, headers);
      return;
    }
    response.writeHead(200, headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    pipeline(fs.createReadStream(thumbnailPath), response, () => undefined);
  } catch {
    empty(response, 404, { "Cache-Control": "no-store" });
  }
}

export function createMediaNodeServer(options: MediaNodeServerOptions): http.Server {
  if (options.signingSecret.length < 32) {
    throw new Error("MEDIA_SIGNING_SECRET 至少需要 32 个字符");
  }
  if (options.controlSecret.length < 32) {
    throw new Error("MEDIA_CONTROL_SECRET 至少需要 32 个字符");
  }
  const store = new MediaNodeStore(options.root);
  return http.createServer(async (request, response) => {
    if (!request.url) {
      empty(response, 404);
      return;
    }
    const url = new URL(request.url, "http://media.local");
    try {
      if (url.pathname === "/health" && request.method === "GET") {
        json(response, 200, { ok: true, storage: "media-node" });
        return;
      }

      const uploadMatch = url.pathname.match(/^\/media-upload\/([a-f0-9]{32})$/);
      if (uploadMatch) {
        const uploadId = uploadMatch[1];
        const allowedOrigin = store.getUploadOrigin(uploadId);
        const requestOrigin = request.headers.origin || "";
        if (!allowedOrigin || requestOrigin !== allowedOrigin) {
          empty(response, 404);
          return;
        }
        const cors = uploadCors(requestOrigin);
        if (request.method === "OPTIONS") {
          empty(response, 204, cors);
          return;
        }
        const uploadToken = bearerToken(request);
        if (request.method === "GET") {
          json(response, 200, { ok: true, nextOffset: await store.uploadStatus(uploadId, uploadToken, requestOrigin) }, cors);
          return;
        }
        if (request.method === "POST") {
          store.authorizeUpload(uploadId, uploadToken, requestOrigin);
          const buffer = await readBody(request, MEDIA_UPLOAD_CHUNK_BYTES);
          const nextOffset = await store.appendUploadChunk(
            uploadId,
            uploadToken,
            requestOrigin,
            Number(request.headers["x-upload-offset"]),
            buffer,
          );
          json(response, 200, { ok: true, nextOffset }, cors);
          return;
        }
        empty(response, 405, cors);
        return;
      }

      if (url.pathname.startsWith("/control/")) {
        if (!controlAuthorized(request, options.controlSecret)) {
          json(response, 401, { ok: false, message: "控制凭证无效" });
          return;
        }
        if (url.pathname === "/control/uploads" && request.method === "POST") {
          const body = await readJson<MediaNodeUploadRequest>(request);
          json(response, 201, { ok: true, ...store.startUpload(body) });
          return;
        }
        const finishMatch = url.pathname.match(/^\/control\/uploads\/([a-f0-9]{32})\/finish$/);
        if (finishMatch && request.method === "POST") {
          json(response, 200, { ok: true, receipt: await store.finishUpload(finishMatch[1]) });
          return;
        }
        const cancelMatch = url.pathname.match(/^\/control\/uploads\/([a-f0-9]{32})$/);
        if (cancelMatch && request.method === "DELETE") {
          json(response, 200, { ok: true, cancelled: await store.cancelUpload(cancelMatch[1]) });
          return;
        }
        if (url.pathname === "/control/manifest" && request.method === "GET") {
          json(response, 200, {
            ok: true,
            ...(await store.manifestPage({
              cursor: url.searchParams.get("cursor"),
              limit: Number(url.searchParams.get("limit") || 1_000),
              refresh: url.searchParams.get("refresh") === "1",
            })),
          });
          return;
        }
        if (url.pathname === "/control/folders" && request.method === "POST") {
          const body = await readJson<{ kind: MediaNodeKind; folder: string }>(request);
          json(response, 201, { ok: true, folder: store.createFolder(body.kind, body.folder) });
          return;
        }
        if (url.pathname === "/control/folders" && request.method === "PATCH") {
          const body = await readJson<{ kind: MediaNodeKind; folder: string; nextFolder: string }>(request);
          json(response, 200, { ok: true, folder: store.renameFolder(body.kind, body.folder, body.nextFolder) });
          return;
        }
        if (url.pathname === "/control/folders" && request.method === "DELETE") {
          const body = await readJson<{ kind: MediaNodeKind; folder: string }>(request);
          json(response, 200, { ok: true, deleted: store.deleteFolder(body.kind, body.folder) });
          return;
        }
        if (url.pathname === "/control/assets/move" && request.method === "POST") {
          const body = await readJson<{ sourceStoredName: string; targetStoredName: string }>(request);
          json(response, 200, {
            ok: true,
            moved: store.moveAsset(body.sourceStoredName, body.targetStoredName),
          });
          return;
        }
        if (url.pathname === "/control/assets/delete" && request.method === "POST") {
          const body = await readJson<{ storedNames: string[] }>(request);
          json(response, 200, { ok: true, ...store.deleteAssets(Array.isArray(body.storedNames) ? body.storedNames : []) });
          return;
        }
        if (url.pathname === "/control/probe" && request.method === "POST") {
          const body = await readJson<{ storedName: string; mtimeMs: number; sizeBytes: number }>(request);
          json(response, 200, {
            ok: true,
            durationSeconds: await store.probeDuration(body.storedName, {
              mtimeMs: Number(body.mtimeMs),
              sizeBytes: Number(body.sizeBytes),
            }),
          });
          return;
        }
        if (url.pathname === "/control/thumbnails/prepare" && request.method === "POST") {
          const body = await readJson<{
            storedName: string;
            mtimeMs: number;
            sizeBytes: number;
            percent: number;
            durationSeconds?: number | null;
          }>(request);
          await store.thumbnail(body);
          json(response, 200, { ok: true, ready: true });
          return;
        }
        if (url.pathname === "/control/thumbnails" && request.method === "DELETE") {
          json(response, 200, { ok: true, removed: store.clearThumbnails() });
          return;
        }
        empty(response, 404);
        return;
      }

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        url.pathname.startsWith("/media-thumbnail/")
      ) {
        await serveSignedThumbnail(request, response, url, store, options.signingSecret);
        return;
      }
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        url.pathname.startsWith("/media-file/")
      ) {
        await serveSignedMedia(request, response, url, store.root, options.signingSecret);
        return;
      }
      empty(response, 404);
    } catch (error) {
      const origin = request.headers.origin || "";
      const uploadId = url.pathname.match(/^\/media-upload\/([a-f0-9]{32})$/)?.[1];
      const cors = uploadId && store.getUploadOrigin(uploadId) === origin ? uploadCors(origin) : {};
      if (error instanceof MediaNodeStoreError) {
        json(response, error.status, { ok: false, message: error.message }, cors);
        return;
      }
      console.error("[media-node] request failed", error);
      json(response, 500, { ok: false, message: "媒体节点操作失败" }, cors);
    }
  });
}
