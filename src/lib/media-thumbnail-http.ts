import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getVideoThumbnailSettings } from "./config";
import type { MediaAsset } from "./media";
import { ensureMediaThumbnail, mediaThumbnailEtag } from "./media-thumbnail";
import { createSignedMediaThumbnailUrl } from "./media-signing";
import { isRemoteMediaStorage, MediaStorageConfigurationError } from "./media-storage-config";

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
    if (isRemoteMediaStorage()) {
      const remoteUrl = createSignedMediaThumbnailUrl({
        storedName: asset.storedName,
        mtimeMs: asset.mtimeMs,
        sizeBytes: asset.sizeBytes,
        percent: settings.singlePercent,
        publiclyAccessible,
      });
      return new Response(null, {
        status: 307,
        headers: {
          ...mediaThumbnailRedirectCacheHeaders(publiclyAccessible),
          Location: remoteUrl,
        },
      });
    }
    const options = {
      fraction: settings.singlePercent / 100,
      cacheKey: `single-${settings.singlePercent}`,
    };
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
  } catch (error) {
    if (error instanceof MediaStorageConfigurationError) {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 404 });
  }
}

export function mediaThumbnailRedirectCacheHeaders(publiclyAccessible: boolean): Record<string, string> {
  if (publiclyAccessible) {
    return {
      "Cache-Control": "public, max-age=300",
      "Cloudflare-CDN-Cache-Control": "public, max-age=300",
    };
  }
  return {
    "Cache-Control": "private, max-age=300",
    Vary: "Cookie",
  };
}
