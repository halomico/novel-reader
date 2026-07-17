import { NextRequest } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getMediaAsset } from "@/lib/media";
import { serveMediaDelivery } from "@/lib/media-delivery";

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
  return serveMediaDelivery(request, { asset, download: false });
}
