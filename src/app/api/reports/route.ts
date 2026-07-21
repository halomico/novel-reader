import { NextRequest, NextResponse } from "next/server";
import { getUserDailyReportLimit } from "@/lib/config";
import { createContentReport, isContentReportCategory } from "@/lib/reports";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  if (user.role !== "user") {
    return NextResponse.json({ ok: false, message: "管理员无需提交举报" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式有误" }, { status: 400 });
  }
  const category = body.category;
  const details = String(body.details || "").trim();
  if (!isContentReportCategory(category) || details.length > 200 || (category === "other" && !details)) {
    return NextResponse.json({ ok: false, message: category === "other" && !details ? "请填写补充说明" : "举报内容有误" }, { status: 400 });
  }

  try {
    const result = createContentReport({
      userId: user.id,
      novelId: Number(body.novelId),
      category,
      details,
      dailyLimit: getUserDailyReportLimit(),
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.reason === "limit" ? "今日举报次数已达上限" : "举报对象不存在" },
        { status: result.reason === "limit" ? 429 : 400 },
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to create content report", error);
    return NextResponse.json({ ok: false, message: "提交失败，请稍后重试" }, { status: 500 });
  }
}
