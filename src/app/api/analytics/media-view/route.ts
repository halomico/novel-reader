import { type NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateEngagementEventId } from "@/core/engagement/record";
import { engagementViewerKey } from "@/core/engagement/viewer";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { getPostgresMediaSummary, recordPostgresMediaView } from "@/domains/media/postgres-media-engagement";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const parsed = await readJsonBody<{ mediaId?: unknown; eventId?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "body_too_large" : "invalid_body" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  const mediaId = Number(body.mediaId);
  const eventId = validateEngagementEventId(body.eventId);
  if (!eventId || !Number.isSafeInteger(mediaId) || mediaId < 1) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const executor = database("web");
  const [user, settings, asset] = await Promise.all([
    getCurrentUserFromRequest(request),
    readPostgresSiteSettings(),
    getPostgresMediaSummary(executor, mediaId),
  ]);
  if (!asset || !canBrowseHomePortal(settings.homePortalAccessModes[asset.kind], Boolean(user))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const access = await checkPostgresContentAccess(executor, request.headers, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: true,
  });
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.status === 429 ? "rate_limited" : "not_found" },
      { status: access.status === 429 ? 429 : 404, headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined },
    );
  }
  const viewerKey = engagementViewerKey(request.headers, user?.id);
  try {
    const result = await recordPostgresMediaView({
      eventId,
      viewerKey,
      media: asset,
      userId: user?.id,
      headers: request.headers,
      referrer: request.headers.get("referer"),
      analyticsEnabled: settings.analyticsEnabled,
    });
    if (!result.accepted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ counted: result.counted, duplicate: result.duplicateEvent }, { status: result.counted ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to record media engagement", error);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}
