import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { isMediaKindConsumable } from "@/domains/media/media-model";
import { getPostgresMediaAsset, incrementPostgresMediaPlayCount } from "@/domains/media/postgres-media-catalog";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromRequest(request);
  const asset = await getPostgresMediaAsset(database("web"), Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindConsumable(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = await checkPostgresContentAccess(database("web"), request.headers, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) {
    return new Response(null, { status: 404 });
  }
  await incrementPostgresMediaPlayCount(database("web"), asset.id);
  return new Response(null, { status: 204 });
}
