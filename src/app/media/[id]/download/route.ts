import { NextRequest } from "next/server";
import { getMediaAsset, incrementMediaDownloadCount, isMediaKindAccessible } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || asset.kind !== "file" || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  incrementMediaDownloadCount(asset.id);
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      Location: mediaDeliveryUrl(asset, true),
      Vary: "Cookie",
    },
  });
}
