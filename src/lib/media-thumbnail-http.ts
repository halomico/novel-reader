import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getVideoThumbnailSettings } from "./config";
import type { MediaAsset } from "./media";
import { ensureMediaThumbnail, mediaThumbnailEtag } from "./media-thumbnail";

export function mediaThumbnailCacheHeaders(publiclyAccessible: boolean): Record<string, string> {
  if (publiclyAccessible) {
    return {
      "Cache-Control": "public, max-age=86400, immutable",
      "Cloudflare-CDN-Cache-Control": "public, max-age=300",
    };
  }
  return {
    "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800, immutable",
    Vary: "Cookie",
  };
}

export async function serveMediaThumbnail(
  request: NextRequest,
  asset: MediaAsset,
  publiclyAccessible = false,
): Promise<Response> {
  try {
    const settings = getVideoThumbnailSettings();
    const requestedFrame = Number(request.nextUrl.searchParams.get("frame") || 0);
    const frame = Math.min(Math.max(Number.isInteger(requestedFrame) ? requestedFrame : 0, 0), settings.carouselFrames - 1);
    const options = settings.mode === "carousel"
      ? { fraction: (frame + 1) / (settings.carouselFrames + 1), cacheKey: `carousel-${settings.carouselFrames}-${frame}` }
      : { fraction: settings.singlePercent / 100, cacheKey: `single-${settings.singlePercent}` };
    const thumbnailPath = await ensureMediaThumbnail(asset, options);
    const stat = fs.statSync(thumbnailPath);
    const etag = mediaThumbnailEtag(asset.id, stat.mtimeMs, stat.size);
    const cacheHeaders = {
      ...mediaThumbnailCacheHeaders(publiclyAccessible),
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
    };
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: cacheHeaders });
    }
    return new Response(Readable.toWeb(fs.createReadStream(thumbnailPath)) as ReadableStream<Uint8Array>, {
      headers: {
        ...cacheHeaders,
        "Content-Length": String(stat.size),
        "Content-Type": "image/jpeg",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
