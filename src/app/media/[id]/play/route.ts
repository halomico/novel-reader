import { NextRequest } from "next/server";
import { getMediaAsset, incrementMediaPlayCount, isMediaKindEnabled } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!getCurrentUserFromRequest(request)) {
    return new Response(null, { status: 401 });
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindEnabled(asset.kind)) {
    return new Response(null, { status: 404 });
  }
  incrementMediaPlayCount(asset.id);
  return new Response(null, { status: 204 });
}
