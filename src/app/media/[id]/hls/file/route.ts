import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { hasValidPostgresVideoDownloadSession } from "@/domains/media/postgres-media-access";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { hasPublishedMediaHls, isMediaKindConsumable } from "@/domains/media/media-model";
import { serveLocalMediaHlsFile } from "@/lib/media-hls-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  const asset = await getPostgresMediaAsset(database("web"), Number((await params).id));
  const sessionValid = user && asset?.kind === "video" && user.role !== "admin"
    ? await hasValidPostgresVideoDownloadSession(database("web"), {
        userId: user.id,
        mediaId: asset.id,
        token: request.nextUrl.searchParams.get("session") || "",
      })
    : true;
  if (
    !user ||
    !asset ||
    asset.kind !== "video" ||
    !isMediaKindConsumable("video", true) ||
    request.nextUrl.searchParams.get("download") !== "1" ||
    request.nextUrl.searchParams.get("v") !== asset.playbackVersion ||
    !hasPublishedMediaHls(asset) ||
    !asset.playbackManifestPath ||
    !sessionValid
  ) {
    return new Response(null, { status: 404 });
  }
  const access = await checkPostgresContentAccess(database("web"), request.headers, {
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
