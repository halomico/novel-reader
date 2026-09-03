import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { toggleNovelGrove } from "@/lib/grove";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard; params }: { params: Promise<{ id: string }> }) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  const novelId = Number((await params).id);
  if (!Number.isInteger(novelId) || novelId < 1) {
    return NextResponse.json({ ok: false, message: "小说不存在" }, { status: 404 });
  }
  const result = toggleNovelGrove(user.id, novelId);
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json({ ok: false, message: "小说不存在" }, { status: 404 });
}
