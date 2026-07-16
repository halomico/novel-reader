import { NextRequest } from "next/server";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const requestedVersion = request.nextUrl.searchParams.get("v");
  if (requestedVersion && Math.floor(Number(requestedVersion)) !== Math.floor(asset.mtimeMs)) {
    return new Response(null, { status: 404 });
  }
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "private, max-age=3600, immutable",
      Location: mediaDeliveryUrl(asset),
      Vary: "Cookie",
    },
  });
}
