import { type NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateEngagementEventId } from "@/core/engagement/record";
import { engagementViewerKey } from "@/core/engagement/viewer";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { getPostgresMediaSummary, recordPostgresMediaView } from "@/domains/media/postgres-media-engagement";
import { canConsumeHomePortal } from "@/lib/home-portal";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const parsed = await readJsonBody<{ eventId?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_body" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const mediaId = Number((await params).id);
  const eventId = validateEngagementEventId(parsed.value.eventId);
  if (!eventId || !Number.isSafeInteger(mediaId) || mediaId < 1) {
    return new Response(null, { status: 404 });
  }
  const executor = database("web");
  const [user, settings, asset] = await Promise.all([
    getCurrentUserFromRequest(request),
    readPostgresSiteSettings(),
    getPostgresMediaSummary(executor, mediaId),
  ]);
  if (!asset || !canConsumeHomePortal(settings.homePortalAccessModes[asset.kind], Boolean(user))) {
    return new Response(null, { status: 404 });
  }
  const access = await checkPostgresContentAccess(executor, request.headers, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) return new Response(null, { status: 404 });
  try {
    const result = await recordPostgresMediaView({
      eventId,
      viewerKey: engagementViewerKey(request.headers, user?.id),
      media: asset,
      userId: user?.id,
      headers: request.headers,
      referrer: request.headers.get("referer"),
      analyticsEnabled: settings.analyticsEnabled,
    });
    return new Response(null, { status: result.accepted ? 204 : 404 });
  } catch (error) {
    console.error("Failed to record media access", error);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}
