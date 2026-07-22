import { NextRequest } from "next/server";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { getTagBySlug } from "@/lib/tags";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return new Response(null, { status: 403 });
  }

  let slug = "";
  try {
    const body = await request.json() as { slug?: unknown };
    slug = typeof body.slug === "string" ? body.slug.trim() : "";
  } catch {
    return new Response(null, { status: 400 });
  }

  const user = getCurrentUserFromRequest(request);
  if (!isTagLibraryEnabled() || (!user && !isGuestTagLibraryNavEnabled())) {
    return new Response(null, { status: 404 });
  }

  const tag = getTagBySlug(slug);
  if (!tag) {
    return new Response(null, { status: 404 });
  }

  recordAnalyticsEvent({
    headers: request.headers,
    userId: user?.id ?? null,
    eventType: "tag_click",
    path: `/tags/${tag.slug}`,
    referrer: request.headers.get("referer"),
    tagId: tag.id,
  });
  return new Response(null, { status: 204 });
}
