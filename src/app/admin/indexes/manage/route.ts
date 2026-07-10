import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { checkAdminOperationLimit } from "@/lib/admin-operation-limit";
import { deleteContentIndexTerms } from "@/lib/content-index";
import { getContentIndexDb } from "@/lib/content-index-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

async function requireAdminJson(request: NextRequest) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return { ok: false as const, response: new NextResponse(null, { status: 404 }) };
  }

  const session = await getAdminSession();
  if (!session) {
    return { ok: false as const, response: jsonError("请先登录后台", 401) };
  }

  const limitedMessage = checkAdminOperationLimit(access.clientIp, "indexes-manage");
  if (limitedMessage) {
    return { ok: false as const, response: jsonError(limitedMessage, 429) };
  }

  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: { action?: unknown; terms?: unknown } = {};
  try {
    body = (await request.json()) as { action?: unknown; terms?: unknown };
  } catch {
    return jsonError("索引管理请求格式有误", 400);
  }

  if (body.action !== "delete") {
    return jsonError("不支持的索引管理操作", 400);
  }

  const terms = Array.isArray(body.terms) ? body.terms.map((item) => String(item || "")) : [];
  const deleted = deleteContentIndexTerms(getContentIndexDb(), terms);
  revalidatePath("/admin/indexes");
  return NextResponse.json({ ok: true, deleted });
}
