import { NextRequest } from "next/server";
import { authorizeMediaDelivery, resolveMediaDeliveryUri, serveMediaDelivery } from "@/lib/media-delivery";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { checkContentAccess } from "@/lib/content-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function deliver(request: NextRequest) {
  const delivery = resolveMediaDeliveryUri(`${request.nextUrl.pathname}${request.nextUrl.search}`);
  const user = getCurrentUserFromRequest(request);
  const access = checkContentAccess(request.headers, {
    scope: "media",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!delivery || !access.allowed || !authorizeMediaDelivery(delivery, Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  return serveMediaDelivery(request, delivery);
}

export const GET = deliver;
export const HEAD = deliver;
