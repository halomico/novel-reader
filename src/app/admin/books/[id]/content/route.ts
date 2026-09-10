import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { database } from "@/core/db/postgres";
import { getPostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import { ContentNotPublishedError, readPublishedNovelContent } from "@/domains/reading/postgres-content";
import { getAdminAccessState } from "@/lib/admin-access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!getAdminAccessState(_request.headers).allowed) return new NextResponse(null, { status: 404 });
  if (!(await getAdminSession())) {
    return new NextResponse("未登录", { status: 401 });
  }

  const { id } = await context.params;
  const bookId = Number(id);
  const book = Number.isSafeInteger(bookId) && bookId > 0 && bookId <= 2_147_483_647
    ? await getPostgresPublicNovel(database(), bookId) : null;
  if (!book) {
    return new NextResponse("小说不存在", { status: 404 });
  }

  try {
    const content = await readPublishedNovelContent(database(), { novelId: bookId });
    return new NextResponse(content.blocks.map((block) => block.originalText).join(""), {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  } catch (error) {
    if (error instanceof ContentNotPublishedError) {
      return new NextResponse("正文尚未发布", { status: 409, headers: { "cache-control": "private, no-store" } });
    }
    return new NextResponse("正文读取失败", { status: 500 });
  }
}
