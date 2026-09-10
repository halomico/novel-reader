import { NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import { validateSameOriginMutation } from "@/core/security/origin";
import { getPostgresMediaSummary } from "@/domains/media/postgres-media-engagement";
import { canConsumeHomePortal } from "@/lib/home-portal";
import { recommendPostgresMediaWithSoda } from "@/domains/activity/postgres-recommendations";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  if (!await hasPostgresUserPermission(database("web"), user, "novel_feedback")) {
    return NextResponse.json({ ok: false, message: "当前等级暂时不能推荐" }, { status: 403 });
  }

  const mediaId = Number((await params).id);
  const [asset, settings] = await Promise.all([getPostgresMediaSummary(database("web"), mediaId), readPostgresSiteSettings()]);
  if (!asset || asset.kind === "file" || !canConsumeHomePortal(settings.homePortalAccessModes[asset.kind], true)) {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }
  const result = await recommendPostgresMediaWithSoda(user.id, mediaId);
  if (result.ok) {
    return NextResponse.json(result);
  }
  return result.reason === "insufficient_soda"
    ? NextResponse.json({ ok: false, message: "苏打不足，签到后再来推荐" }, { status: 409 })
    : NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
}
