import { NextRequest } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { recordPostgresAnalyticsEvent } from "@/domains/analytics/postgres-events";
import { getPostgresCatalogTagBySlug } from "@/domains/catalog/postgres-tags";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return new Response(null, { status: 403 });
  }

  const parsed = await readJsonBody<{ slug?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) {
    return new Response(null, { status: parsed.reason === "too_large" ? 413 : 400 });
  }
  const slug = typeof parsed.value.slug === "string" ? parsed.value.slug.trim() : "";

  const user = await getCurrentUserFromRequest(request);
  const settings = await readPostgresSiteSettings();
  if (!canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user))) {
    return new Response(null, { status: 404 });
  }

  const tag = await getPostgresCatalogTagBySlug(database("web"), slug, {
    audience: user?.role === "admin" ? "admin" : user ? "member" : "public",
  });
  if (!tag) {
    return new Response(null, { status: 404 });
  }

  if (settings.analyticsEnabled) {
    await recordPostgresAnalyticsEvent(database("web"), {
      headers: request.headers,
      userId: user?.id ?? null,
      eventType: "tag_click",
      path: `/tags/${tag.slug}`,
      referrer: request.headers.get("referer"),
      tagId: tag.id,
    });
  }
  return new Response(null, { status: 204 });
}
