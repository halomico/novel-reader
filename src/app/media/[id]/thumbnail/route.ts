import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess, hasPostgresScopedContentAccessRules } from "@/domains/access/postgres-content-access";
import { isMediaKindAccessible } from "@/domains/media/media-model";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { serveMediaThumbnail } from "@/lib/media-thumbnail-http";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  const asset = await getPostgresMediaAsset(database("web"), Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = await checkPostgresContentAccess(database("web"), request.headers, {
    scope: "video",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) {
    return new Response(null, { status: 404 });
  }

  const publiclyCacheable = isMediaKindAccessible(asset.kind, false) && !await hasPostgresScopedContentAccessRules(database("web"), "video");
  return serveMediaThumbnail(request, asset, publiclyCacheable);
}
