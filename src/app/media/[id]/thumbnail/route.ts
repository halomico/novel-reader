import { NextRequest } from "next/server";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
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
  const access = checkContentAccess(request.headers, {
    scope: "media",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) {
    return new Response(null, { status: 404 });
  }

  const publiclyCacheable = isMediaKindAccessible(asset.kind, false) && !hasScopedContentAccessRules("media");
  return serveMediaThumbnail(request, asset, publiclyCacheable);
}
