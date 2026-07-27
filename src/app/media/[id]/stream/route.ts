import { NextRequest } from "next/server";
import { getMediaAsset, isMediaKindAccessible, isMediaKindPublic } from "@/lib/media";
import { mediaDeliveryUrl } from "@/lib/media-delivery";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio") || !isMediaKindAccessible(asset.kind, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = checkContentAccess(request.headers, {
    scope: "media",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return new Response(null, {
      status: access.status,
      headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined,
    });
  }
  const requestedVersion = request.nextUrl.searchParams.get("v");
  if (requestedVersion && Math.floor(Number(requestedVersion)) !== Math.floor(asset.mtimeMs)) {
    return new Response(null, { status: 404 });
  }
  let location: string;
  const publiclyAccessible = isMediaKindPublic(asset.kind) && !hasScopedContentAccessRules("media");
  try {
    location = mediaDeliveryUrl(asset, false, {
      publiclyAccessible,
    });
  } catch {
    return new Response(null, { status: 503 });
  }
  return new Response(null, {
    status: 307,
    headers: publiclyAccessible
      ? {
          "Cache-Control": "public, max-age=300",
          "Cloudflare-CDN-Cache-Control": "public, max-age=300",
          Location: location,
        }
      : {
          "Cache-Control": "private, no-store",
          Location: location,
          Vary: "Cookie",
        },
  });
}
