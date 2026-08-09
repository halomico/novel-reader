import { after, type NextRequest } from "next/server";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getNovelById } from "@/lib/books";
import { canAccessNovelLibrary } from "@/lib/config";
import { checkContentAccess } from "@/lib/content-access";
import { getClientIp } from "@/lib/admin-access";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { recordNovelVisit } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return new Response(null, { status: 403, headers: NO_STORE_HEADERS });
  }

  let novelId = 0;
  try {
    const body = await request.json() as { novelId?: unknown };
    novelId = Number(body.novelId);
  } catch {
    return new Response(null, { status: 400, headers: NO_STORE_HEADERS });
  }

  if (!Number.isInteger(novelId) || novelId < 1 || !canAccessNovelLibrary(false)) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS });
  }
  if (getCurrentUserFromRequest(request)) {
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  }

  const book = getNovelById(novelId);
  if (!book) {
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS });
  }
  const access = checkContentAccess(request.headers, {
    scope: "novel",
    authenticated: false,
    rateLimit: false,
  });
  if (!access.allowed) {
    return new Response(null, { status: access.status, headers: NO_STORE_HEADERS });
  }

  after(() => {
    recordNovelVisit(book.id, getClientIp(request.headers), request.headers.get("user-agent") || "");
    recordAnalyticsEvent({
      headers: request.headers,
      eventType: "book_view",
      path: `/books/${book.id}`,
      referrer: request.headers.get("referer"),
      novelId: book.id,
    });
  });
  return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
}
