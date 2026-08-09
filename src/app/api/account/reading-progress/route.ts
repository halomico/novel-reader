import { NextResponse } from "next/server";
import { getNovelById } from "@/lib/books";
import { getNovelChapter } from "@/lib/novel-library";
import { getNovelReadAccess } from "@/lib/novel-access";
import {
  clearReadingProgress,
  deleteReadingProgress,
  deleteReadingProgressMany,
  getReadingProgress,
  listRecentReadingProgress,
  updateReadingProgress,
  type ReadingProgressUpdate,
} from "@/lib/reading-progress";
import { getCurrentUser } from "@/lib/user-auth";

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ ok: false, message: "请先登录" }, 401);
  }
  const url = new URL(request.url);
  const novelId = Number(url.searchParams.get("novelId") || 0);
  if (Number.isInteger(novelId) && novelId > 0) {
    return privateJson({ ok: true, progress: getReadingProgress(user.id, novelId) });
  }
  if (!user.readingHistoryEnabled) {
    return privateJson({ ok: true, items: [] });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 3), 1), 100);
  return privateJson({ ok: true, items: listRecentReadingProgress(user.id, limit) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ ok: false, message: "请先登录" }, 401);
  }

  let payload: ReadingProgressUpdate & { novelId?: number };
  try {
    payload = await request.json() as ReadingProgressUpdate & { novelId?: number };
  } catch {
    return privateJson({ ok: false, message: "阅读进度无效" }, 400);
  }
  const novelId = Number(payload.novelId || 0);
  const book = Number.isInteger(novelId) && novelId > 0 ? getNovelById(novelId) : null;
  if (!book) {
    return privateJson({ ok: false, message: "小说不存在" }, 404);
  }
  if (
    !Number.isFinite(payload.segmentIndex) ||
    !Number.isFinite(payload.segmentRatio) ||
    !Number.isFinite(payload.progressPercent) ||
    typeof payload.contentVersion !== "string" ||
    typeof payload.completed !== "boolean"
  ) {
    return privateJson({ ok: false, message: "阅读进度无效" }, 400);
  }
  let chapterSortOrder: number | null = null;
  if (payload.chapterId != null) {
    const chapterId = Number(payload.chapterId);
    const chapter = Number.isInteger(chapterId) && chapterId > 0 ? getNovelChapter(book.id, chapterId) : null;
    if (!chapter) {
      return privateJson({ ok: false, message: "章节不存在" }, 400);
    }
    payload.chapterId = chapterId;
    chapterSortOrder = chapter.sortOrder;
  }
  if (!getNovelReadAccess(book, user, { chapterSortOrder }).allowed) {
    return privateJson({ ok: false, message: "当前内容尚未解锁" }, 403);
  }

  const result = updateReadingProgress(user.id, book, payload);
  return privateJson({ ok: true, ...result });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ ok: false, message: "请先登录" }, 401);
  }
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "1") {
    return privateJson({ ok: true, deleted: clearReadingProgress(user.id) });
  }
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const payload = await request.json() as { novelIds?: number[] };
      if (Array.isArray(payload.novelIds)) {
        return privateJson({
          ok: true,
          deleted: deleteReadingProgressMany(user.id, payload.novelIds.map(Number)),
        });
      }
    } catch {
      return privateJson({ ok: false, message: "删除内容无效" }, 400);
    }
  }
  const novelId = Number(url.searchParams.get("novelId") || 0);
  if (!Number.isInteger(novelId) || novelId < 1) {
    return privateJson({ ok: false, message: "请选择要删除的记录" }, 400);
  }
  return privateJson({ ok: true, deleted: deleteReadingProgress(user.id, novelId) ? 1 : 0 });
}
