import { NextRequest } from "next/server";
import { authorizeMediaDelivery, resolveMediaDeliveryUri, serveMediaDelivery } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { isMediaKindPublic } from "@/lib/media";
import { hasValidVideoDownloadSession } from "@/lib/media-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest) {
  const delivery = resolveMediaDeliveryUri(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (!delivery) {
    return new Response(null, { status: 404 });
  }
  const user = getCurrentUserFromRequest(request);
  const access = checkContentAccess(request.headers, {
    scope: delivery.asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (
    !access.allowed ||
    !authorizeMediaDelivery(delivery, Boolean(user)) ||
    (delivery.download && delivery.asset.kind === "video" && (
      !user || (user.role !== "admin" && !hasValidVideoDownloadSession({
        userId: user.id,
        mediaId: delivery.asset.id,
        token: delivery.downloadToken,
      }))
    ))
  ) {
    return new Response(null, { status: 404 });
  }
  return serveMediaDelivery(request, delivery, {
    publiclyAccessible: !delivery.download &&
      isMediaKindPublic(delivery.asset.kind) &&
      !hasScopedContentAccessRules(delivery.asset.kind),
  });
}

export const GET = deliver;
export const HEAD = deliver;
