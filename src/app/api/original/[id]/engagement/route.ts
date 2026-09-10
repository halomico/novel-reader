import { type NextRequest, NextResponse } from "next/server";
import { engagementViewerKey } from "@/core/engagement/viewer";
import { validateEngagementEventId } from "@/core/engagement/record";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { recordOriginalEngagement } from "@/domains/originals";
import { checkRateLimit } from "@/lib/rate-limit";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const articleId = Number((await params).id);
  if (!Number.isSafeInteger(articleId) || articleId <= 0) {
    return NextResponse.json({ error: "invalid_article" }, { status: 400 });
  }
  const parsed = await readJsonBody<{ eventId?: unknown; action?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: parsed.reason === "too_large" ? "body_too_large" : "invalid_body" },
      { status: parsed.reason === "too_large" ? 413 : 400 },
    );
  }
  const body = parsed.value;
  const eventId = validateEngagementEventId(body.eventId);
  if (!eventId) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  const user = await getCurrentUserFromRequest(request);
  const viewerKey = engagementViewerKey(request.headers, user?.id);
  const limit = checkRateLimit({
    key: `original-engagement:${viewerKey}`,
    limit: 40,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" },
    });
  }
  const result = await recordOriginalEngagement({
    eventId,
    viewerKey,
    articleId,
    userId: user?.id,
    action: body.action === "read_open" ? "read_open" : "detail_view",
  });
  return result.recorded
    ? NextResponse.json({ counted: result.counted, duplicate: result.duplicateEvent }, {
        status: result.counted ? 201 : 200,
        headers: { "Cache-Control": "no-store" },
      })
    : NextResponse.json({ error: "article_not_found" }, { status: 404 });
}
