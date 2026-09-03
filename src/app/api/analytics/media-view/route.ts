import { type NextRequest, NextResponse } from "next/server";
import { recordEngagementEvent, validateEngagementEventId } from "@/core/engagement/record";
import { engagementViewerKey } from "@/core/engagement/viewer";
import { validateSameOriginMutation } from "@/core/security/origin";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { checkContentAccess } from "@/lib/content-access";
import { getDb } from "@/lib/db";
import { getMediaAsset, isMediaKindAccessible } from "@/lib/media";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { recordMediaHistory } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  let body: { mediaId?: unknown; eventId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "invalid_body" }, { status: 400 }); }
  const mediaId = Number(body.mediaId);
  const eventId = validateEngagementEventId(body.eventId);
  const user = getCurrentUserFromRequest(request);
  const asset = Number.isSafeInteger(mediaId) && mediaId > 0 ? getMediaAsset(mediaId) : null;
  if (!eventId || !asset || !isMediaKindAccessible(asset.kind, Boolean(user))) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const access = checkContentAccess(request.headers, { scope: asset.kind, authenticated: Boolean(user), admin: user?.role === "admin", rateLimit: false });
  if (!access.allowed) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const viewerKey = engagementViewerKey(request.headers, user?.id);
  const limit = checkRateLimit({ key: `media-view:${viewerKey}`, limit: 50, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = recordEngagementEvent(db, { eventId, viewerKey, contentType: asset.kind, contentId: asset.id, action: "detail_view" }, () => {
      recordAnalyticsEvent({ headers: request.headers, userId: user?.id ?? null, eventType: `${asset.kind}_view`, path: `/media/${asset.id}`, referrer: request.headers.get("referer"), mediaId: asset.id });
      if (user) recordMediaHistory(user.id, asset);
    });
    db.exec("COMMIT");
    return NextResponse.json({ counted: result.counted, duplicate: result.duplicateEvent }, { status: result.counted ? 201 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("Failed to record media engagement", error);
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }
}
