import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { getPostgresVideoPlaybackAccess } from "@/domains/media/postgres-media-access";
import { validatePostgresVideoPlaybackLease } from "@/domains/media/postgres-video-playback";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { hasPublishedMediaHls, isMediaKindConsumable, parseMediaByteRange } from "@/domains/media/media-model";
import { getMediaDir } from "@/lib/config";
import { isRemoteMediaStorage } from "@/lib/media-storage-config";
import { playbackViewerFromRequest } from "@/lib/playback-viewer";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { resolvePlaybackHlsFile } from "@/lib/video-hls";
import { hlsSegmentsPubliclyCacheable } from "@/lib/video-hls-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const asset = await getPostgresMediaAsset(database("web"), Number((await params).id));
  // Free HLS segments are intentionally cacheable after a logged-in ticket mints the playlist.
  if (!asset || asset.kind !== "video" || isRemoteMediaStorage()) {
    return new Response(null, { status: 404 });
  }
  // Free HLS: playlist is minted only after login; segment bytes are cacheable without cookies.
  const publiclyAccessible = hlsSegmentsPubliclyCacheable(asset);
  const user = publiclyAccessible ? null : await getCurrentUserFromRequest(request);
  if (!publiclyAccessible) {
    if (!isMediaKindConsumable("video", Boolean(user))) {
      return new Response(null, { status: 404 });
    }
    const access = await checkPostgresContentAccess(database("web"), request.headers, {
      scope: "video",
      authenticated: Boolean(user),
      admin: user?.role === "admin",
      rateLimit: true,
    });
    if (!access.allowed) return new Response(null, { status: access.status });
  }
  if (request.nextUrl.searchParams.get("v") !== asset.playbackVersion) {
    return new Response(null, { status: 404 });
  }
  if (!publiclyAccessible) {
    const viewer = playbackViewerFromRequest(request, user?.id || null);
    const sessionId = request.nextUrl.searchParams.get("ps") || "";
    const token = request.nextUrl.searchParams.get("pt") || "";
    if (
      !viewer ||
      !(await getPostgresVideoPlaybackAccess(database("web"), asset.id, user))?.allowed ||
      !await validatePostgresVideoPlaybackLease(database("web"), {
        id: sessionId,
        token,
        viewerKey: viewer.viewerKey,
        mediaId: asset.id,
      })
    ) {
      return new Response(null, { status: 403 });
    }
  }
  if (!hasPublishedMediaHls(asset) || !asset.playbackManifestPath) {
    return new Response(null, { status: 404 });
  }
  const fileName = request.nextUrl.searchParams.get("file") || "";
  const filePath = resolvePlaybackHlsFile(getMediaDir(), asset.playbackManifestPath, fileName);
  if (!filePath) return new Response(null, { status: 404 });
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response(null, { status: 404 });
  }
  if (!stat.isFile() || stat.size <= 0) return new Response(null, { status: 404 });
  const etag = `"hls-${asset.id}-${asset.playbackVersion}-${fileName}-${stat.size}"`;
  const lastModified = stat.mtime.toUTCString();
  let rangeHeader = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  if (rangeHeader && ifRange && ifRange !== etag && ifRange !== lastModified) {
    rangeHeader = null;
  }
  const range = parseMediaByteRange(rangeHeader, stat.size);
  const origin = publiclyAccessible ? "*" : request.headers.get("origin") || "*";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
    "Cache-Control": publiclyAccessible
      ? "public, max-age=3600, immutable, no-transform"
      : "private, max-age=300, no-transform",
    "Content-Type": fileName.endsWith(".m4s") ? "video/iso.segment" : "video/mp4",
    "Cross-Origin-Resource-Policy": "cross-origin",
    ETag: etag,
    "Last-Modified": lastModified,
    "X-Content-Type-Options": "nosniff",
  });
  if (publiclyAccessible) {
    headers.set("CDN-Cache-Control", "public, max-age=3600, immutable, no-transform");
    headers.set("Cloudflare-CDN-Cache-Control", "public, max-age=3600, immutable, no-transform");
  } else {
    headers.set("Vary", "Cookie, Origin");
  }
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${stat.size}`);
    return new Response(null, { status: 416, headers });
  }
  if (!range && request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
  if (request.method === "HEAD") {
    return new Response(null, { status: range ? 206 : 200, headers });
  }
  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(
    Readable.toWeb(stream) as ReadableStream<Uint8Array>,
    { status: range ? 206 : 200, headers },
  );
}

export const GET = deliver;
export const HEAD = deliver;
