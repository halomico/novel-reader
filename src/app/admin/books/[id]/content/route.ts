import { NextResponse } from "next/server";
import { getAdminSession } from "@/lib/admin-auth";
import { getNovelById, readNovelContent } from "@/lib/books";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getAdminSession())) {
    return new NextResponse("未登录", { status: 401 });
  }

  const { id } = await context.params;
  const bookId = Number(id);
  const book = Number.isInteger(bookId) && bookId > 0 ? getNovelById(bookId) : null;
  if (!book) {
    return new NextResponse("小说不存在", { status: 404 });
  }

  try {
    return new NextResponse(await readNovelContent(book), {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    });
  } catch {
    return new NextResponse("正文读取失败", { status: 500 });
  }
}
