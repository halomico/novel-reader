import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline } from "node:stream";
import { verifySignedMediaUrl } from "../src/lib/media-signing";

function mediaRoot(): string {
  return path.resolve(process.env.MEDIA_NODE_DIR || process.env.MEDIA_DIR || "./data/media");
}

function contentDisposition(fileName: string, download: boolean): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const mode = download ? "attachment" : "inline";
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
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

const root = mediaRoot();
fs.mkdirSync(root, { recursive: true });

const server = http.createServer(async (request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Cache-Control": "no-store", "Content-Type": "application/json" });
    response.end('{"ok":true}');
    return;
  }
  if ((request.method !== "GET" && request.method !== "HEAD") || !request.url) {
    response.writeHead(404).end();
    return;
  }

  const url = new URL(request.url, "http://media.local");
  const payload = verifySignedMediaUrl(url);
  if (!payload) {
    response.writeHead(404).end();
    return;
  }
  const filePath = path.resolve(root, ...payload.storedName.split("/"));
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(404).end();
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    response.writeHead(404).end();
    return;
  }
  if (!stat.isFile() || stat.size <= 0) {
    response.writeHead(404).end();
    return;
  }

  const range = parseRange(request.headers.range, stat.size);
  if (range === "invalid") {
    response.writeHead(416, { "Content-Range": `bytes */${stat.size}` }).end();
    return;
  }
  const start = range?.start || 0;
  const end = range?.end ?? stat.size - 1;
  const etag = `"media-${Math.floor(stat.mtimeMs)}-${stat.size}"`;
  const headers: Record<string, string> = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": contentDisposition(payload.fileName, payload.download),
    "Content-Length": String(end - start + 1),
    "Content-Type": payload.mimeType,
    "Cross-Origin-Resource-Policy": "cross-origin",
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  if (!range && request.headers["if-none-match"] === etag) {
    delete headers["Content-Length"];
    response.writeHead(304, headers).end();
    return;
  }
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  pipeline(fs.createReadStream(filePath, { start, end }), response, () => undefined);
});

const port = Number(process.env.MEDIA_NODE_PORT || 3100);
server.listen(Number.isFinite(port) ? port : 3100, "0.0.0.0");
