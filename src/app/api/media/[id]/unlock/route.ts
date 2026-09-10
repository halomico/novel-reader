import { NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { unlockPostgresVideoWithSoda } from "@/domains/media/postgres-media-access";
import { getPostgresMediaSummary } from "@/domains/media/postgres-media-engagement";
import { canConsumeHomePortal } from "@/lib/home-portal";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  const mediaId = Number((await params).id);
  const [asset, settings] = await Promise.all([getPostgresMediaSummary(database("web"), mediaId), readPostgresSiteSettings()]);
  if (!asset || asset.kind !== "video" || !canConsumeHomePortal(settings.homePortalAccessModes.video, true)) {
    return NextResponse.json({ ok: false, message: "视频不存在" }, { status: 404 });
  }
  const result = await unlockPostgresVideoWithSoda({ userId: user.id, mediaId });
  if (!result.ok) {
    const message = result.reason === "insufficient_soda"
      ? "苏打不足"
      : result.reason === "account_unavailable"
        ? "账户当前不可用"
        : "视频不存在";
    return NextResponse.json({ ok: false, message }, { status: result.reason === "not_found" ? 404 : 403 });
  }
  return NextResponse.json(result);
}
