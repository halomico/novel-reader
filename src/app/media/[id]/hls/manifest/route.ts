import { NextRequest } from "next/server";
import { getVideoPlaybackAccess } from "@/lib/media-access";
import { checkContentAccess } from "@/lib/content-access";
import {
  getMediaAsset,
  hasPublishedMediaHls,
  isMediaKindConsumable,
} from "@/lib/media";
import { playbackViewerFromRequest } from "@/lib/playback-viewer";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { validateVideoPlaybackLease } from "@/lib/video-playback";
import { buildAuthorizedPlaybackHlsManifest } from "@/lib/video-hls-delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Fallback playlist endpoint. Prefer the inline `manifest` from POST /api/media-playback
 * to avoid this extra RTT. Kept for Safari/bookmark compatibility and older clients.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindConsumable("video", Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "video",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) return new Response(null, { status: access.status });
  if (request.nextUrl.searchParams.get("v") !== asset.playbackVersion) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasPublishedMediaHls(asset) || !asset.playbackManifestPath) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const viewer = playbackViewerFromRequest(request, user?.id || null);
  const playbackAccess = getVideoPlaybackAccess(asset, user);
  const sessionId = request.nextUrl.searchParams.get("ps") || "";
  const token = request.nextUrl.searchParams.get("pt") || "";
  if (!viewer || !playbackAccess.allowed || !validateVideoPlaybackLease({
    id: sessionId,
    token,
    viewerKey: viewer.viewerKey,
    mediaId: asset.id,
  })) {
    return new Response(null, { status: 403 });
  }
  try {
    const { manifest } = await buildAuthorizedPlaybackHlsManifest(asset, { sessionId, token });
    return new Response(manifest, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("origin") || "*",
        "Cache-Control": "private, no-store",
        "Content-Type": "application/vnd.apple.mpegurl; charset=utf-8",
        Vary: "Cookie",
      },
    });
  } catch {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
