import { type NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { togglePostgresMediaGrove } from "@/domains/activity/postgres-grove";
import { getPostgresMediaSummary } from "@/domains/media/postgres-media-engagement";
import { canConsumeHomePortal } from "@/lib/home-portal";
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
  const mediaId = Number((await params).id);
  const [asset, settings] = await Promise.all([getPostgresMediaSummary(database("web"), mediaId), readPostgresSiteSettings()]);
  if (!asset || asset.kind === "file" || !canConsumeHomePortal(settings.homePortalAccessModes[asset.kind], true)) {
    return NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
  }
  const result = await togglePostgresMediaGrove(user.id, mediaId);
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json({ ok: false, message: "媒体不存在" }, { status: 404 });
}
