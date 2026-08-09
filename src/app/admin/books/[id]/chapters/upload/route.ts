import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { appendUploadedNovelChapters } from "@/lib/novel-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = getAdminAccessState(request.headers);
  if (!access.allowed) return new NextResponse(null, { status: 404 });
  if (!(await getAdminSession())) return jsonError("请先登录后台", 401);

  const { id } = await params;
  const novelId = Number(id);
  if (!Number.isInteger(novelId) || novelId < 1) return jsonError("小说不存在", 404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("上传请求格式有误", 400);
  }
  const files = formData.getAll("files").filter((item): item is File => item instanceof File && item.size > 0);
  if (!files.length) return jsonError("请选择至少一个 TXT 章节", 400);

  try {
    const added = await appendUploadedNovelChapters(novelId, files);
    revalidatePath("/novels");
    revalidatePath(`/books/${novelId}`);
    revalidatePath(`/books/${novelId}/chapters`);
    revalidatePath(`/admin/books/${novelId}/chapters`);
    return NextResponse.json({ ok: true, added });
  } catch (error) {
    const message = error instanceof Error ? error.message : "章节上传失败";
    const expected = /小说|章节|TXT/.test(message);
    if (!expected) console.error("Failed to append novel chapters", error);
    return jsonError(expected ? message : "章节保存失败，请检查小说目录权限和磁盘空间", expected ? 400 : 500);
  }
}
