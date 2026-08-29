import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { countActiveContentJobs } from "@/lib/content-jobs";
import { invalidateContentSearchResultCache } from "@/lib/content-search-cache";
import { deleteContentSearchDatabase } from "@/lib/content-search-db";
import { getNovelSourceById } from "@/lib/novel-library";

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

  return { ok: true as const };
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminJson(request);
  if (!auth.ok) {
    return auth.response;
  }

  let body: { action?: unknown; sourceId?: unknown } = {};
  try {
    body = (await request.json()) as { action?: unknown; sourceId?: unknown };
  } catch {
    return jsonError("索引管理请求格式有误", 400);
  }
  if (body.action !== "clear") {
    return jsonError("不支持的索引管理操作", 400);
  }
  if (countActiveContentJobs("index") > 0) {
    return jsonError("索引任务运行期间不能清空索引", 409);
  }

  const sourceId = Number(body.sourceId || 0);
  const source = Number.isInteger(sourceId) && sourceId > 0 ? getNovelSourceById(sourceId) : null;
  if (!source) return jsonError("小说书库不存在", 404);
  deleteContentSearchDatabase(source.id);
  invalidateContentSearchResultCache();
  revalidatePath("/admin/indexes");
  revalidatePath("/admin");
  return NextResponse.json({ ok: true, message: `${source.name}的全文索引已删除` });
}
