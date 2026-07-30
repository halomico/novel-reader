import { NextRequest } from "next/server";
import { getMediaAsset, incrementMediaDownloadCount, isMediaKindAccessible } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { checkContentAccess } from "@/lib/content-access";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (
    !asset ||
    (asset.kind !== "file" && asset.kind !== "video") ||
    !isMediaKindAccessible(asset.kind, Boolean(user)) ||
    (asset.kind === "video" && (!user || !hasUserPermission(user, "video_download")))
  ) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return new Response(null, {
      status: access.status,
      headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined,
    });
  }
  incrementMediaDownloadCount(asset.id);
  let location: string;
  try {
    location = mediaDeliveryUrl(asset, true);
  } catch {
    return new Response(null, { status: 503 });
  }
  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "private, no-store",
      Location: location,
      Vary: "Cookie",
    },
  });
}
