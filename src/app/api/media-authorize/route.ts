import { NextRequest } from "next/server";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { hasValidPostgresVideoDownloadSession } from "@/domains/media/postgres-media-access";
import { getPostgresMediaAsset } from "@/domains/media/postgres-media-catalog";
import { authorizeMediaDelivery, mediaDeliveryHeaders, resolveMediaDeliveryUri } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const originalMethod = request.headers.get("x-forwarded-method") || "GET";
  const originalUri = request.headers.get("x-forwarded-uri") || "";
  if (originalMethod !== "GET" && originalMethod !== "HEAD") {
    return new Response(null, { status: 404 });
  }
  const delivery = await resolveMediaDeliveryUri(originalUri, (id) => getPostgresMediaAsset(database("web"), id));
  if (!delivery) {
    return new Response(null, { status: 404 });
  }
  const user = await getCurrentUserFromRequest(request);
  const downloadSessionValid = delivery.download && delivery.asset.kind === "video" && user?.role !== "admin"
    ? await hasValidPostgresVideoDownloadSession(database("web"), {
        userId: user?.id ?? 0,
        mediaId: delivery.asset.id,
        token: delivery.downloadToken,
      }).catch(() => false)
    : true;
  const access = await checkPostgresContentAccess(database("web"), request.headers, {
    scope: delivery.asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (
    !access.allowed ||
    !authorizeMediaDelivery(delivery, Boolean(user)) ||
    (delivery.download && delivery.asset.kind === "video" && (
      !user || !downloadSessionValid
    ))
  ) {
    return new Response(null, { status: 404 });
  }

  const deliveryHeaders = mediaDeliveryHeaders(delivery);
  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Media-Cache-Control": deliveryHeaders.get("cache-control") || "private, max-age=300",
      "X-Media-Content-Disposition": deliveryHeaders.get("content-disposition") || "inline",
    },
  });
}
