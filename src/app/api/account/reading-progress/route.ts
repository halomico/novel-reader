import { NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import { getPostgresChapterContext, getPostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import {
  getPostgresReadingProgress,
  hidePostgresReadingProgress,
  isCurrentPostgresReadingContentVersion,
  listPostgresReadingProgressPage,
  updatePostgresReadingProgress,
  type PostgresReadingProgressUpdate,
} from "@/domains/reading/postgres-reading-progress";
import { getPostgresNovelReadAccess } from "@/domains/reading/postgres-novel-access";
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
    return privateJson({ ok: true, progress: await getPostgresReadingProgress(database("web"), user.id, novelId) });
  }
  if (!user.readingHistoryEnabled) {
    return privateJson({ ok: true, items: [] });
  }
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 3), 1), 100);
  const page = await listPostgresReadingProgressPage(database("web"), user.id, { page: 1, pageSize: limit });
  return privateJson({ ok: true, items: page.items });
}

export async function PUT(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ ok: false, message: "请先登录" }, 401);
  }
  if (!user.readingHistoryEnabled) {
    return privateJson({ ok: false, message: "阅读进度已关闭" }, 409);
  }

  const parsed = await readJsonBody<PostgresReadingProgressUpdate & { novelId?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) {
    return privateJson({ ok: false, message: parsed.reason === "too_large" ? "请求内容过大" : "阅读进度无效" }, parsed.reason === "too_large" ? 413 : 400);
  }
  const payload = parsed.value;
  const novelId = payload.novelId;
  const executor = database("web");
  const book = typeof novelId === "number" && Number.isSafeInteger(novelId) && novelId > 0
    ? await getPostgresPublicNovel(executor, novelId)
    : null;
  if (!book) {
    return privateJson({ ok: false, message: "小说不存在" }, 404);
  }
  if (
    !Number.isFinite(payload.segmentIndex) ||
    !Number.isFinite(payload.segmentRatio) ||
    !Number.isFinite(payload.progressPercent) ||
    typeof payload.contentVersion !== "string" ||
    typeof payload.completed !== "boolean" ||
    (payload.savedAt !== undefined && (!Number.isSafeInteger(payload.savedAt) || payload.savedAt < 1))
  ) {
    return privateJson({ ok: false, message: "阅读进度无效" }, 400);
  }
  let chapterSortOrder: number | null = null;
  let resolvedChapterId: number | null = null;
  let authoritativeVersion = book.publishedContentVersion;
  if (payload.chapterId != null) {
    const chapterId = payload.chapterId;
    const chapterContext = typeof chapterId === "number" && Number.isSafeInteger(chapterId) && chapterId > 0
      ? await getPostgresChapterContext(executor, book.id, chapterId)
      : null;
    if (!chapterContext) {
      return privateJson({ ok: false, message: "章节不存在" }, 400);
    }
    resolvedChapterId = chapterId;
    chapterSortOrder = chapterContext.chapter.sortOrder;
    authoritativeVersion = chapterContext.chapter.publishedContentVersion;
  }
  if (!authoritativeVersion) {
    return privateJson({ ok: false, message: "正文正在准备，请稍后再试" }, 409);
  }
  if (payload.contentVersion !== authoritativeVersion &&
      !await isCurrentPostgresReadingContentVersion(executor, book.id, resolvedChapterId, payload.contentVersion)) {
    return privateJson({ ok: false, message: "正文已更新，请刷新后继续阅读" }, 409);
  }
  const settings = await readPostgresSiteSettings();
  const access = await getPostgresNovelReadAccess(
    executor,
    book,
    user,
    settings.homePortalAccessModes.novels,
    {
      storageMode: book.storageMode,
      chapterCount: book.chapterCount,
      previewChapterCount: book.previewChapterCount,
      chapterSortOrder,
    },
  );
  if (!access.allowed) {
    return privateJson({ ok: false, message: "当前内容尚未解锁" }, 403);
  }

  const result = await updatePostgresReadingProgress({
    userId: user.id,
    novelId: book.id,
    chapterId: resolvedChapterId,
    title: book.title,
    contentVersion: payload.contentVersion,
    segmentIndex: payload.segmentIndex,
    segmentRatio: payload.segmentRatio,
    progressPercent: payload.progressPercent,
    completed: payload.completed,
    savedAt: payload.savedAt,
  });
  return privateJson({ ok: true, ...result });
}

export async function DELETE(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user) {
    return privateJson({ ok: false, message: "请先登录" }, 401);
  }
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "1") {
    return privateJson({ ok: true, deleted: await hidePostgresReadingProgress(database("web"), user.id) });
  }
  if (request.headers.get("content-type")?.includes("application/json")) {
    const parsed = await readJsonBody<{ novelIds?: number[] }>(request, 32 * 1024);
    if (!parsed.ok) {
      return privateJson({ ok: false, message: parsed.reason === "too_large" ? "请求内容过大" : "删除内容无效" }, parsed.reason === "too_large" ? 413 : 400);
    }
    if (Array.isArray(parsed.value.novelIds)) {
      if (parsed.value.novelIds.some((id) => typeof id !== "number")) {
        return privateJson({ ok: false, message: "删除内容无效" }, 400);
      }
      return privateJson({
        ok: true,
        deleted: await hidePostgresReadingProgress(database("web"), user.id, parsed.value.novelIds),
      });
    }
  }
  const novelId = Number(url.searchParams.get("novelId") || 0);
  if (!Number.isInteger(novelId) || novelId < 1) {
    return privateJson({ ok: false, message: "请选择要删除的记录" }, 400);
  }
  return privateJson({ ok: true, deleted: await hidePostgresReadingProgress(database("web"), user.id, [novelId]) });
}
