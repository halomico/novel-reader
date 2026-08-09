import { NextRequest } from "next/server";
import { getVideoPlaybackAccess } from "@/lib/media-access";
import { getMediaAsset, isMediaKindConsumable, isMediaKindContentPublic } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { playbackViewerFromRequest } from "@/lib/playback-viewer";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { estimateVideoBitrateKbps, validateVideoPlaybackLease } from "@/lib/video-playback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindConsumable(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return new Response(null, {
      status: access.status,
      headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined,
    });
  }
  const requestedVersion = request.nextUrl.searchParams.get("v");
  if (requestedVersion && Math.floor(Number(requestedVersion)) !== Math.floor(asset.mtimeMs)) {
    return new Response(null, { status: 404 });
  }
  if (asset.kind === "video") {
    const viewer = playbackViewerFromRequest(request, user?.id || null);
    const playbackAccess = getVideoPlaybackAccess(asset, user);
    if (!viewer || !playbackAccess.allowed || !validateVideoPlaybackLease({
      id: request.nextUrl.searchParams.get("ps") || "",
      token: request.nextUrl.searchParams.get("pt") || "",
      viewerKey: viewer?.viewerKey || "",
      mediaId: asset.id,
    })) {
      return new Response(null, { status: 403 });
    }
  }
  let location: string;
  const publiclyAccessible = asset.kind !== "video" && isMediaKindContentPublic(asset.kind) && !hasScopedContentAccessRules(asset.kind);
  try {
    location = mediaDeliveryUrl(asset, false, {
      publiclyAccessible,
      estimatedKbps: asset.kind === "video" ? estimateVideoBitrateKbps(asset) : 0,
    });
  } catch {
    return new Response(null, { status: 503 });
  }
  return new Response(null, {
    status: 307,
    headers: publiclyAccessible
      ? {
          "Cache-Control": "public, max-age=300",
          "Cloudflare-CDN-Cache-Control": "public, max-age=300",
          Location: location,
        }
      : {
          "Cache-Control": "private, no-store",
          Location: location,
          Vary: "Cookie",
        },
  });
}
