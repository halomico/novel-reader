import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { checkAdminOperationLimit } from "@/lib/admin-operation-limit";
import { updateNovelVisitStats } from "@/lib/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(message: string, status: number, ok = false) {
  return NextResponse.json({ ok, message }, { status });
}

export async function POST(request: NextRequest) {
  return json("访问统计不支持手动修改", 404);

  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    return json(access.reason || "当前请求不能访问后台", 403);
  }

  const session = await getAdminSession();
  if (!session) {
    return json("后台登录已过期", 401);
  }

  const limitedMessage = checkAdminOperationLimit(access.clientIp, "/admin/books");
  if (limitedMessage) {
    return json(limitedMessage, 429);
  }

  let body: { bookId?: unknown; visitCount?: unknown; lastAccessedAt?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json("请求格式不正确", 400);
  }

  const bookId = Number(body.bookId);
  const visitCount = Number(body.visitCount);
  const rawLastAccessedAt = String(body.lastAccessedAt || "").trim();
  let lastAccessedAt: string | null = null;

  if (!Number.isInteger(bookId) || bookId < 1 || !Number.isFinite(visitCount) || visitCount < 0) {
    return json("访问统计参数不正确", 400);
  }

  if (rawLastAccessedAt) {
    const date = new Date(rawLastAccessedAt);
    if (Number.isNaN(date.getTime())) {
      return json("最后访问时间格式不正确", 400);
    }
    lastAccessedAt = date.toISOString();
  }

  const updated = updateNovelVisitStats(bookId, visitCount, lastAccessedAt);
  revalidatePath("/admin/books");
  return json(updated ? "访问统计已保存" : "小说不存在", updated ? 200 : 404, updated);
}
