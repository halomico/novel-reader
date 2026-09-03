import { type NextRequest, NextResponse } from "next/server";
import { isOriginalAuthorBlocked, setOriginalAuthorBlocked } from "@/lib/original";
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
  const authorId = Number((await params).id);
  if (!Number.isSafeInteger(authorId) || authorId <= 0 || authorId === user.id) {
    return NextResponse.json({ ok: false, message: "不能屏蔽该用户" }, { status: 400 });
  }
  let body: { blocked?: unknown } = {};
  try {
    body = await request.json() as { blocked?: unknown };
  } catch {
    return NextResponse.json({ ok: false, message: "请求格式有误" }, { status: 400 });
  }
  const blocked = body.blocked === true;
  const current = isOriginalAuthorBlocked(user.id, authorId);
  if (current !== blocked && !setOriginalAuthorBlocked(user.id, authorId, blocked)) {
    return NextResponse.json({ ok: false, message: "用户不存在或状态未改变" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, blocked });
}
