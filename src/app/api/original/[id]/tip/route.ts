import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { OriginalInputError, tipOriginalAuthor } from "@/domains/originals/postgres-originals";
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
  if (!user) return NextResponse.json({ ok: false, message: "请先登录" }, { status: 401 });
  try {
    const result = await tipOriginalAuthor(Number((await params).id), user.id);
    return NextResponse.json({ ok: true, amount: result.amount, balance: result.balance });
  } catch (error) {
    const message = error instanceof OriginalInputError ? error.message : "打赏失败，请稍后重试";
    const tipped = message === "每篇文章只能打赏一次";
    return NextResponse.json({ ok: false, message, tipped }, { status: tipped ? 409 : error instanceof OriginalInputError ? 400 : 500 });
  }
}
