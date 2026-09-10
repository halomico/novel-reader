import { NextRequest, NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { validateSameOriginMutation } from "@/core/security/origin";
import { unlockPostgresNovelWithSoda } from "@/domains/reading/postgres-reader-interactions";
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
  const novelId = Number((await params).id);
  const settings = await readPostgresSiteSettings();
  if (!Number.isInteger(novelId) || novelId < 1 ||
      !canConsumeHomePortal(settings.homePortalAccessModes.novels, true)) {
    return NextResponse.json({ ok: false, message: "小说不存在" }, { status: 404 });
  }
  const result = await unlockPostgresNovelWithSoda(user.id, novelId);
  if (!result.ok) {
    const message = result.reason === "insufficient_soda"
      ? "苏打不足"
      : result.reason === "account_unavailable"
        ? "账户当前不可用"
        : "小说不存在";
    return NextResponse.json({ ok: false, message }, { status: result.reason === "not_found" ? 404 : 403 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
