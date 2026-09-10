import { NextResponse } from "next/server";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { validateSameOriginMutation } from "@/core/security/origin";
import { readJsonBody } from "@/core/security/request-body";
import {
  clearPostgresOriginalReadingProgress,
  deletePostgresOriginalReadingProgressMany,
  getPostgresOriginalAccess,
  getPostgresOriginalReadingProgress,
  updatePostgresOriginalReadingProgress,
} from "@/domains/originals/postgres-reading";
import { canConsumeHomePortal } from "@/lib/home-portal";
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
  return privateJson({ ok: true, progress: await getPostgresOriginalReadingProgress(database("web"), user.id, articleId) });
}

export async function PUT(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  const parsed = await readJsonBody<{ articleId?: unknown; scrollRatio?: unknown }>(request, 16 * 1024);
  if (!parsed.ok) {
    return privateJson({ ok: false, message: parsed.reason === "too_large" ? "请求内容过大" : "阅读进度无效" }, parsed.reason === "too_large" ? 413 : 400);
  }
  const body = parsed.value;
  const articleId = Number(body.articleId || 0);
  const scrollRatio = Number(body.scrollRatio);
  if (!Number.isInteger(articleId) || articleId < 1) return privateJson({ ok: false, message: "文章不存在" }, 404);
  if (!Number.isFinite(scrollRatio) || scrollRatio < 0 || scrollRatio > 1) {
    return privateJson({ ok: false, message: "阅读进度无效" }, 400);
  }
  if (!user.originalReadingHistoryEnabled) {
    return privateJson({ ok: false, message: "阅读进度已关闭" }, 409);
  }
  const [settings, access] = await Promise.all([
    readPostgresSiteSettings(),
    getPostgresOriginalAccess(database("web"), articleId, user),
  ]);
  if (!access.exists) return privateJson({ ok: false, message: "文章不存在" }, 404);
  if (!settings.originalChannelEnabled || !canConsumeHomePortal(settings.homePortalAccessModes.original, true) || !access.allowed) {
    return privateJson({ ok: false, message: "当前内容尚未解锁" }, 403);
  }
  return privateJson({ ok: true, ...await updatePostgresOriginalReadingProgress(database("web"), user.id, articleId, scrollRatio) });
}

export async function DELETE(request: Request) {
  const guard = validateSameOriginMutation(request);
  if (guard) return guard;
  const user = await getCurrentUser();
  if (!user) return privateJson({ ok: false, message: "请先登录" }, 401);
  const url = new URL(request.url);
  if (url.searchParams.get("all") === "1") {
    return privateJson({ ok: true, deleted: await clearPostgresOriginalReadingProgress(database("web"), user.id) });
  }
  const parsed = await readJsonBody<{ articleIds?: unknown }>(request, 32 * 1024);
  if (!parsed.ok || !Array.isArray(parsed.value.articleIds)) {
    return privateJson({
      ok: false,
      message: parsed.ok ? "请选择要删除的记录" : parsed.reason === "too_large" ? "请求内容过大" : "请选择要删除的记录",
    }, parsed.ok || parsed.reason !== "too_large" ? 400 : 413);
  }
  return privateJson({
    ok: true,
    deleted: await deletePostgresOriginalReadingProgressMany(database("web"), user.id, parsed.value.articleIds.map(Number)),
  });
}
