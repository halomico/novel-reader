import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { savePostgresUploadedChapterNovel, savePostgresUploadedNovels } from "@/domains/catalog/postgres-novel-storage";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readFormBody } from "@/core/security/request-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest) {
  const guard = validateSameOriginMutation(request, { requireJson: false, requireMutationHeader: false });
  if (guard) return guard;
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) {
    return new NextResponse(null, { status: 404 });
  }

  const session = await getAdminSession();
  if (!session) {
    return jsonError("请先登录后台", 401);
  }
  const parsed = await readFormBody(request, 256 * 1024 * 1024);
  if (!parsed.ok) {
    return jsonError(parsed.reason === "too_large" ? "小说上传请求不能超过 256 MB" : "上传请求格式有误", parsed.reason === "too_large" ? 413 : 400);
  }
  const formData = parsed.value;
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (files.length === 0) {
    return jsonError("请选择至少一个 .txt 文件", 400);
  }
  if (files.length > 1000 || files.some((file) => file.size > 64 * 1024 * 1024) || files.reduce((total, file) => total + file.size, 0) > 256 * 1024 * 1024) {
    return jsonError("单次最多上传 1000 个文件，单文件不超过 64 MB，合计不超过 256 MB", 413);
  }

  if (formData.get("mode") === "chapters") {
    try {
      const result = await savePostgresUploadedChapterNovel({
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

  let results: Awaited<ReturnType<typeof savePostgresUploadedNovels>>;
  try {
    results = await savePostgresUploadedNovels(files, Number(formData.get("sourceId") || 0));
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
