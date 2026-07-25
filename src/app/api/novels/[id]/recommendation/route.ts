import { NextRequest, NextResponse } from "next/server";
import { recommendNovelWithSoda } from "@/lib/recommendations";
import { getCurrentUserFromRequest } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  if (!hasUserPermission(user, "novel_feedback")) {
    return NextResponse.json({ ok: false, message: "当前等级暂不能推荐" }, { status: 403 });
  }

  const result = recommendNovelWithSoda(user.id, Number((await params).id));
  if (result.ok) {
    return NextResponse.json(result);
  }
  return result.reason === "insufficient_soda"
    ? NextResponse.json({ ok: false, message: "苏打不足，签到后再来推荐" }, { status: 409 })
    : NextResponse.json({ ok: false, message: "小说不存在" }, { status: 404 });
}
