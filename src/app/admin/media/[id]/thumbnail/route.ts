import { NextRequest } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getMediaAsset } from "@/lib/media";
import { serveMediaThumbnail } from "@/lib/media-thumbnail-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed || !(await getAdminSession())) {
    return new Response(null, { status: 404 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video") {
    return new Response(null, { status: 404 });
  }
  return serveMediaThumbnail(request, asset);
}
