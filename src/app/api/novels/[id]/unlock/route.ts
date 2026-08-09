import { NextRequest, NextResponse } from "next/server";
import { getNovelById } from "@/lib/books";
import { canConsumeNovelLibrary } from "@/lib/config";
import { unlockNovelWithSoda } from "@/lib/novel-access";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getCurrentUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  }
  const novelId = Number((await params).id);
  if (!Number.isInteger(novelId) || novelId < 1 || !getNovelById(novelId) || !canConsumeNovelLibrary(true)) {
    return NextResponse.json({ ok: false, message: "小说不存在" }, { status: 404 });
  }
  const result = unlockNovelWithSoda(user.id, novelId);
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
