import { type NextRequest, NextResponse } from "next/server";
import { OriginalInputError, tipOriginalAuthor } from "@/lib/original";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site") {
    return NextResponse.json({ ok: false, message: "请求无效" }, { status: 403 });
  }
  const user = getCurrentUserFromRequest(request);
  if (!user) return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  try {
    const result = tipOriginalAuthor(Number((await params).id), user.id);
    return NextResponse.json({ ok: true, amount: result.amount, balance: result.balance });
  } catch (error) {
    const message = error instanceof OriginalInputError ? error.message : "打赏失败，请稍后重试";
    return NextResponse.json({ ok: false, message }, { status: error instanceof OriginalInputError ? 400 : 500 });
  }
}
