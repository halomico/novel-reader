import { NextRequest, NextResponse } from "next/server";
import {
  normalizePostgresSearchAnalyticsQuery,
  recordPostgresSearchQuery,
  recordPostgresSearchResultClick,
  updatePostgresSearchQueryResults,
} from "@/domains/analytics/postgres-search-analytics";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { validateSearchKeyword } from "@/lib/search-query";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function canRecord(request: NextRequest) {
  const [user, settings] = await Promise.all([
    getCurrentUserFromRequest(request),
    readPostgresSiteSettings(),
  ]);
  return {
    user,
    enabled: settings.analyticsEnabled,
    allowed: canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user)),
  };
}

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const parsed = await readJsonBody<Record<string, unknown>>(request, 32 * 1024);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: parsed.reason === "too_large" ? "请求过大" : "请求格式有误" },
      { status: parsed.reason === "too_large" ? 413 : 400, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const body = parsed.value;

  const access = await canRecord(request);
  if (!access.allowed) {
    return NextResponse.json({ ok: false, message: "搜索不可用" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  }

  const action = String(body.action || "");
  if (action === "results") {
    if (access.enabled) await updatePostgresSearchQueryResults(
      database("web"),
      String(body.eventKey || ""),
      Number(body.resultCount),
      Number(body.resultNovelCount),
    );
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (action === "click") {
    if (access.enabled) await recordPostgresSearchResultClick(
      database("web"),
      String(body.eventKey || ""),
      Number(body.novelId),
      body.segmentIndex === undefined ? null : Number(body.segmentIndex),
    );
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (action === "current") {
    const query = normalizePostgresSearchAnalyticsQuery(String(body.query || ""));
    const validation = validateSearchKeyword(query);
    if (!validation.ok) {
      return NextResponse.json({ ok: false, message: validation.message }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
    }
    if (access.enabled) await recordPostgresSearchQuery(database("web"), query, "content", {
      source: "reader_current",
      userId: access.user?.id ?? null,
      originNovelId: Number(body.originNovelId),
      resultCount: Number(body.resultCount),
      resultNovelCount: Number(body.resultCount) > 0 ? 1 : 0,
    });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  }

  return NextResponse.json({ ok: false, message: "未知操作" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
}
