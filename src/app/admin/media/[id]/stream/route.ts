import { NextRequest } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getMediaAsset, hasPublishedMediaHls } from "@/lib/media";
import { mediaDeliveryUrl, serveMediaDelivery } from "@/lib/media-delivery";
import { mediaHlsFileUrl, serveLocalMediaHlsFile } from "@/lib/media-hls-delivery";
import { isRemoteMediaStorage } from "@/lib/media-storage-config";
import { getVideoPlaybackMode } from "@/lib/video-playback-mode";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed || !(await getAdminSession())) {
    return new Response(null, { status: 404 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) {
    return new Response(null, { status: 404 });
  }
  const requestedVersion = request.nextUrl.searchParams.get("v");
  if (requestedVersion && Math.floor(Number(requestedVersion)) !== Math.floor(asset.mtimeMs)) {
    return new Response(null, { status: 404 });
  }
  if (
    asset.kind === "video" &&
    hasPublishedMediaHls(asset) &&
    asset.playbackManifestPath
  ) {
    if (isRemoteMediaStorage()) {
      try {
        return new Response(null, {
          status: 307,
          headers: { "Cache-Control": "private, no-store", Location: mediaHlsFileUrl(asset, false) },
        });
      } catch {
        return new Response(null, { status: 503 });
      }
    }
    return serveLocalMediaHlsFile(request, asset, false);
  }
  if (asset.kind === "video" && getVideoPlaybackMode() === "hls-only") {
    return new Response(null, { status: 503, headers: { "Retry-After": "60" } });
  }
  if (isRemoteMediaStorage()) {
    try {
      return new Response(null, {
        status: 307,
        headers: {
          "Cache-Control": "private, no-store",
          Location: mediaDeliveryUrl(asset),
        },
      });
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  return serveMediaDelivery(request, {
    asset,
    download: false,
    downloadToken: "",
    playbackSessionId: "",
    playbackToken: "",
  });
}
