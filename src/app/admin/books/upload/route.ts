import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { saveUploadedChapterNovel, saveUploadedNovels } from "@/lib/novel-files";

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

  if (formData.get("mode") === "chapters") {
    try {
      const result = await saveUploadedChapterNovel({
        title: String(formData.get("title") || ""),
        files,
        sourceId: Number(formData.get("sourceId") || 0),
      });
      revalidatePath("/");
      revalidatePath("/admin");
      revalidatePath("/admin/books");
      revalidatePath("/novels");
      return NextResponse.json({ ok: true, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "章节小说上传失败";
      const expected = /小说名称|章节|来源|TXT|不存在|无效/.test(message);
      if (!expected) console.error("Failed to save chapter novel", error);
      return jsonError(expected ? message : "章节小说保存失败，请检查小说目录权限和磁盘空间", expected ? 400 : 500);
    }
  }

  let results: Awaited<ReturnType<typeof saveUploadedNovels>>;
  try {
    results = await saveUploadedNovels(files, Number(formData.get("sourceId") || 0));
  } catch (error) {
    if (error instanceof Error && (error.message === "小说来源不存在" || error.message === "小说来源目录无效")) {
      return jsonError(error.message, 400);
    }
    console.error("Failed to save uploaded novels", error);
    return jsonError("小说文件保存失败，请检查小说目录权限和磁盘空间", 500);
  }
  const saved = results.filter((item) => item.status === "saved").length;
  const duplicates = results.filter((item) => item.status === "duplicate").length;
  const skipped = results.filter((item) => item.status === "skipped").length;
  revalidatePath("/");
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  revalidatePath("/novels");

  return NextResponse.json({
    ok: true,
    saved,
    duplicates,
    skipped,
    processed: results.length,
  });
}
