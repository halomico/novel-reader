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
    return new NextResponse(null, { status: 404 });
  }

  const session = await getAdminSession();
  if (!session) {
    return jsonError("请先登录后台", 401);
  }

  const limitedMessage = checkAdminOperationLimit(access.clientIp, "books-upload");
  if (limitedMessage) {
    return jsonError(limitedMessage, 429);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("上传请求格式有误", 400);
  }
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) {
    return jsonError("请选择至少一个 .txt 文件", 400);
  }

  let results: Awaited<ReturnType<typeof saveUploadedNovels>>;
  try {
    results = await saveUploadedNovels(files);
  } catch (error) {
    console.error("Failed to save uploaded novels", error);
    return jsonError("小说文件保存失败，请检查书库权限和磁盘空间", 500);
  }
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
