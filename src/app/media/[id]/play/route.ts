import { NextRequest } from "next/server";
import { checkContentAccess } from "@/lib/content-access";
import { getMediaAsset, incrementMediaPlayCount, isMediaKindAccessible } from "@/lib/media";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "media",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) {
    return new Response(null, { status: 404 });
  }
  incrementMediaPlayCount(asset.id);
  return new Response(null, { status: 204 });
}
