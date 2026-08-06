import { NextRequest } from "next/server";
import { hasValidVideoDownloadSession } from "@/lib/media-access";
import { checkContentAccess } from "@/lib/content-access";
import { serveLocalMediaHlsFile } from "@/lib/media-hls-delivery";
import { getMediaAsset, hasPublishedMediaHls, isMediaKindConsumable } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (
    !user ||
    !asset ||
    asset.kind !== "video" ||
    !isMediaKindConsumable("video", true) ||
    request.nextUrl.searchParams.get("download") !== "1" ||
    request.nextUrl.searchParams.get("v") !== asset.playbackVersion ||
    !hasPublishedMediaHls(asset) ||
    !asset.playbackManifestPath ||
    (user.role !== "admin" && !hasValidVideoDownloadSession({
      userId: user.id,
      mediaId: asset.id,
      token: request.nextUrl.searchParams.get("session") || "",
    }))
  ) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "video",
    authenticated: true,
    admin: user.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) return new Response(null, { status: access.status });
  return serveLocalMediaHlsFile(request, asset, true);
}

export const GET = deliver;
export const HEAD = deliver;
