import { type NextRequest, NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { isOriginalAuthorBlocked, setOriginalAuthorBlocked } from "@/domains/originals/postgres-originals";
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
  const authorId = Number((await params).id);
  if (!Number.isSafeInteger(authorId) || authorId <= 0 || authorId === user.id) {
    return NextResponse.json({ ok: false, message: "不能屏蔽该用户" }, { status: 400 });
  }
  const parsed = await readJsonBody<{ blocked?: unknown }>(request, 8 * 1024);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.reason === "too_large" ? "请求内容过大" : "请求格式有误" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  }
  const body = parsed.value;
  const blocked = body.blocked === true;
  const current = await isOriginalAuthorBlocked(user.id, authorId);
  if (current !== blocked && !await setOriginalAuthorBlocked(user.id, authorId, blocked)) {
    return NextResponse.json({ ok: false, message: "用户不存在或状态未改变" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, blocked });
}
