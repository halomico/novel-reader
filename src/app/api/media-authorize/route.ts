import { NextRequest } from "next/server";
import { authorizeMediaDelivery, mediaDeliveryHeaders, resolveMediaDeliveryUri } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const originalMethod = request.headers.get("x-forwarded-method") || "GET";
  const originalUri = request.headers.get("x-forwarded-uri") || "";
  if (originalMethod !== "GET" && originalMethod !== "HEAD") {
    return new Response(null, { status: 404 });
  }
  const delivery = resolveMediaDeliveryUri(originalUri);
  const user = getCurrentUserFromRequest(request);
  if (!delivery || !authorizeMediaDelivery(delivery, Boolean(user))) {
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
