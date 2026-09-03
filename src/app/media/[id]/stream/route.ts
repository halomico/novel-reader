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

function redirectCors(request: NextRequest, publiclyAccessible: boolean): Record<string, string> {
  const origin = publiclyAccessible ? "*" : request.headers.get("origin") || "*";
  return {
    "Access-Control-Allow-Headers": "Range, If-None-Match, If-Range, Content-Type",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range, ETag, Last-Modified",
    ...(origin === "*" ? {} : { Vary: "Origin, Cookie" }),
  };
}

export function OPTIONS(request: NextRequest) {
  return new Response(null, {
    status: 204,
    headers: redirectCors(request, false),
  });
}

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
  const corsHeaders = redirectCors(request, publiclyAccessible);
  return new Response(null, {
    status: 307,
    headers: {
      ...corsHeaders,
      ...(publiclyAccessible
        ? {
            "Cache-Control": "public, max-age=300",
            "Cloudflare-CDN-Cache-Control": "public, max-age=300",
          }
        : { "Cache-Control": "private, no-store" }),
      Location: location,
    },
  });
}

// Some browsers/CDNs probe media metadata with HEAD before the first range
// request. Keep it on the same authorization and redirect path as GET.
export async function HEAD(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return GET(request, context);
}
