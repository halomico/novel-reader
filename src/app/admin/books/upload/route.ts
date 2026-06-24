import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { checkAdminOperationLimit } from "@/lib/admin-operation-limit";
import { saveUploadedNovels } from "@/lib/novel-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return jsonError(access.reason || "当前请求不能访问后台", 403);
  }

  const session = await getAdminSession();
  if (!session) {
    return jsonError("请先登录后台", 401);
  }

  const limitedMessage = checkAdminOperationLimit(access.clientIp, "books-upload");
  if (limitedMessage) {
    return jsonError(limitedMessage, 429);
  }

  const formData = await request.formData();
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) {
    return jsonError("请选择至少一个 .txt 文件", 400);
  }

  const results = await saveUploadedNovels(files);
  const saved = results.filter((item) => item.status === "saved").length;
  const duplicates = results.filter((item) => item.status === "duplicate").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/books");

  return NextResponse.json({
    ok: true,
    saved,
    duplicates,
    skipped,
    processed: results.length,
  });
}
