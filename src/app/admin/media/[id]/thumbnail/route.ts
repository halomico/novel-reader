import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { serveMediaThumbnail } from "@/lib/media-thumbnail-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed || !(await getAdminSession())) {
    return new Response(null, { status: 404 });
  }
  const asset = await getPostgresMediaAsset(database("web"), Number((await params).id));
  if (!asset || asset.kind !== "video") {
    return new Response(null, { status: 404 });
  }
  return serveMediaThumbnail(request, asset);
}
