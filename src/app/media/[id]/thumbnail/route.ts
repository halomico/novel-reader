import { NextRequest } from "next/server";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { serveMediaThumbnail } from "@/lib/media-thumbnail-http";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "video" || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }

  return serveMediaThumbnail(request, asset, isMediaKindAccessible(asset.kind, false));
}
