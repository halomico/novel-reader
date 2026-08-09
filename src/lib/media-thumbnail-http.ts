import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getVideoThumbnailSettings } from "./config";
import { findLocalMediaCustomCover } from "./media-cover";
import { mediaThumbnailVersion, type MediaAsset } from "./media";
import { findMediaThumbnail, mediaThumbnailEtag } from "./media-thumbnail";
import { createSignedMediaCoverUrl, createSignedMediaThumbnailUrl } from "./media-signing";
import {
  isRemoteMediaStorage,
  MediaStorageConfigurationError,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";

export function mediaThumbnailCacheHeaders(publiclyAccessible: boolean): Record<string, string> {
  if (publiclyAccessible) {
    return {
      "Cache-Control": "public, max-age=86400, immutable",
      "Cloudflare-CDN-Cache-Control": "public, max-age=86400",
    };
  }
  return {
    "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800, immutable",
    Vary: "Cookie",
  };
}

function serveLocalThumbnailFile(
  request: NextRequest,
  thumbnailPath: string,
  publiclyAccessible: boolean,
  etag: string,
): Response {
  const stat = fs.statSync(thumbnailPath);
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
}

export async function serveMediaThumbnail(
  request: NextRequest,
  asset: MediaAsset,
  publiclyAccessible = false,
): Promise<Response> {
  try {
    const settings = getVideoThumbnailSettings();
    if (asset.customCoverKey) {
      if (isRemoteMediaStorage()) {
        const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
        return new Response(null, {
          status: 307,
          headers: {
            ...mediaThumbnailRedirectCacheHeaders(publiclyAccessible),
            Location: createSignedMediaCoverUrl({
              storageNodeId: node.id,
              key: asset.customCoverKey,
              publiclyAccessible,
            }),
          },
        });
      }
      const customCoverPath = await findLocalMediaCustomCover(asset.customCoverKey);
      if (!customCoverPath) {
        return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
      }
      const stat = fs.statSync(customCoverPath);
      return serveLocalThumbnailFile(
        request,
        customCoverPath,
        publiclyAccessible,
        `"media-cover-${asset.customCoverKey}-${stat.size}"`,
      );
    }
    if (asset.thumbnailVersion !== mediaThumbnailVersion(asset.mtimeMs, settings.singlePercent)) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store", "Retry-After": "2" },
      });
    }
    if (isRemoteMediaStorage()) {
      const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
      const remoteUrl = createSignedMediaThumbnailUrl({
        storageNodeId: node.id,
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
    const thumbnailPath = await findMediaThumbnail(asset, options);
    if (!thumbnailPath) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store", "Retry-After": "2" },
      });
    }
    const stat = fs.statSync(thumbnailPath);
    const etag = mediaThumbnailEtag(asset.id, stat.mtimeMs, stat.size);
    return serveLocalThumbnailFile(request, thumbnailPath, publiclyAccessible, etag);
  } catch (error) {
    if (error instanceof MediaStorageConfigurationError) {
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
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
