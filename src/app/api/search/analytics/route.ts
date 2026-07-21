import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import {
  normalizeSearchAnalyticsQuery,
  recordSearchQuery,
  recordSearchResultClick,
  updateSearchQueryResults,
} from "@/lib/analytics";
import { canAccessNovelLibrary } from "@/lib/config";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function canRecord(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  const admin = user ? null : await getAdminSession();
  return { user, allowed: Boolean(admin) || canAccessNovelLibrary(Boolean(user)) };
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式有误" }, { status: 400 });
  }

  const access = await canRecord(request);
  if (!access.allowed) {
    return NextResponse.json({ ok: false, message: "搜索不可用" }, { status: 404 });
  }

  const action = String(body.action || "");
  if (action === "results") {
    updateSearchQueryResults(
      String(body.eventKey || ""),
      Number(body.resultCount),
      Number(body.resultNovelCount),
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "click") {
    recordSearchResultClick(
      String(body.eventKey || ""),
      Number(body.novelId),
      body.segmentIndex === undefined ? null : Number(body.segmentIndex),
    );
    return NextResponse.json({ ok: true });
  }

  if (action === "current") {
    const query = normalizeSearchAnalyticsQuery(String(body.query || ""));
    if (!query) {
      return NextResponse.json({ ok: false, message: "搜索词不能为空" }, { status: 400 });
    }
    recordSearchQuery(query, "content", {
      source: "reader_current",
      userId: access.user?.id ?? null,
      originNovelId: Number(body.originNovelId),
      resultCount: Number(body.resultCount),
      resultNovelCount: Number(body.resultCount) > 0 ? 1 : 0,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, message: "未知操作" }, { status: 400 });
}
