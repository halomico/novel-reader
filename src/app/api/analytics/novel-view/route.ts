import { type NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateEngagementEventId } from "@/core/engagement/record";
import { engagementViewerKey } from "@/core/engagement/viewer";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { getPostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import { recordPostgresNovelView } from "@/domains/reading/postgres-reader-interactions";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const parsed = await readJsonBody<{ novelId?: unknown; eventId?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) return NextResponse.json({ error: parsed.reason === "too_large" ? "body_too_large" : "invalid_body" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  const novelId = Number(body.novelId);
  const eventId = validateEngagementEventId(body.eventId);
  const [user, settings] = await Promise.all([
    getCurrentUserFromRequest(request),
    readPostgresSiteSettings(),
  ]);
  if (!eventId || !Number.isSafeInteger(novelId) || novelId < 1 ||
      !canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const executor = database("web");
  const book = await getPostgresPublicNovel(executor, novelId);
  if (!book) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const access = await checkPostgresContentAccess(executor, request.headers, {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return NextResponse.json(
      { error: access.status === 429 ? "rate_limited" : "not_found" },
      {
        status: access.status === 429 ? 429 : 404,
        headers: access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : undefined,
      },
    );
  }
  const viewerKey = engagementViewerKey(request.headers, user?.id);
  try {
    const result = await recordPostgresNovelView({
      eventId,
      viewerKey,
      novelId: book.id,
      userId: user?.id,
      headers: request.headers,
      referrer: request.headers.get("referer"),
      analyticsEnabled: settings.analyticsEnabled,
    });
    if (!result.accepted) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ counted: result.counted, duplicate: result.duplicateEvent }, { status: result.counted ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to record novel engagement", error);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}
