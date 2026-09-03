import { NextResponse } from "next/server";
import { validateSameOriginMutation } from "@/core/security/origin";
import { canConsumeOriginalChannel } from "@/lib/config";
import {
  clearOriginalReadingProgress,
  deleteOriginalReadingProgressMany,
  getOriginalAccess,
  getOriginalArticleById,
  getOriginalReadingProgress,
  updateOriginalReadingProgress,
} from "@/lib/original";
import { getCurrentUser } from "@/lib/user-auth";

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  const articleId = Number(new URL(request.url).searchParams.get("articleId") || 0);
  if (!Number.isInteger(articleId) || articleId < 1) {
    return privateJson({ ok: false, message: "文章不存在" }, 404);
  }
  return privateJson({ ok: true, progress: getOriginalReadingProgress(user.id, articleId) });
}

export async function PUT(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  let body: { articleId?: unknown; scrollRatio?: unknown };
  try {
    body = await request.json() as { articleId?: unknown; scrollRatio?: unknown };
  } catch {
    return privateJson({ ok: false, message: "阅读进度无效" }, 400);
  }
  const articleId = Number(body.articleId || 0);
  const scrollRatio = Number(body.scrollRatio);
  const article = Number.isInteger(articleId) && articleId > 0 ? getOriginalArticleById(articleId) : null;
  if (!article) return privateJson({ ok: false, message: "文章不存在" }, 404);
  if (!Number.isFinite(scrollRatio) || scrollRatio < 0 || scrollRatio > 1) {
    return privateJson({ ok: false, message: "阅读进度无效" }, 400);
  }
  if (!user.originalReadingHistoryEnabled) {
    return privateJson({ ok: false, message: "阅读进度已关闭" }, 409);
  }
  if (!canConsumeOriginalChannel(true) || !getOriginalAccess(article, user).allowed) {
    return privateJson({ ok: false, message: "当前内容尚未解锁" }, 403);
  }
  return privateJson({ ok: true, ...updateOriginalReadingProgress(user.id, articleId, scrollRatio) });
}

export async function DELETE(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "1") {
    return privateJson({ ok: true, deleted: clearOriginalReadingProgress(user.id) });
  }
  try {
    const body = await request.json() as { articleIds?: unknown };
    if (!Array.isArray(body.articleIds)) throw new Error("invalid");
    return privateJson({
      ok: true,
      deleted: deleteOriginalReadingProgressMany(user.id, body.articleIds.map(Number)),
    });
  } catch {
    return privateJson({ ok: false, message: "请选择要删除的记录" }, 400);
  }
}
