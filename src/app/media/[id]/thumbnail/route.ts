import fs from "node:fs";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getVideoThumbnailSettings } from "@/lib/config";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { ensureMediaThumbnail, mediaThumbnailEtag } from "@/lib/media-thumbnail";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }

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
      "Cache-Control": "private, max-age=86400, stale-while-revalidate=604800, immutable",
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      Vary: "Cookie",
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
