"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  OriginalInputError,
  deleteOriginalArticles,
  deleteOriginalComments,
  setOriginalArticlePinned,
  setOriginalArticleStatus,
  setOriginalCommentStatus,
  updateOriginalArticleAsAdmin,
  type OriginalArticleStatus,
} from "@/lib/original";

async function requireAdmin() {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed) notFound();
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

function returnPath(formData: FormData): string {
  const requested = String(formData.get("returnPath") || "");
  const isListPath = requested === "/admin/original" || requested.startsWith("/admin/original?");
  const isArticlePath = /^\/admin\/original\/[1-9]\d*(?:\?[^#\\\r\n]*)?$/u.test(requested);
  return (isListPath && !/[\r\n#\\]/u.test(requested)) || isArticlePath
    ? requested
    : "/admin/original";
}

function noticePath(pathname: string, message: string, tone: "success" | "warning" = "success"): never {
  const separator = pathname.includes("?") ? "&" : "?";
  redirect(`${pathname}${separator}notice=${encodeURIComponent(message)}&tone=${tone}`);
}

function articlePath(articleId: number): string {
  return Number.isSafeInteger(articleId) && articleId > 0 ? `/admin/original/${articleId}` : "/admin/original";
}

function actionError(error: unknown): string {
  if (error instanceof OriginalInputError) return error.message;
  console.error("Original admin action failed", error);
  return "操作失败，请稍后重试";
}

export async function setOriginalArticleStatusAction(formData: FormData) {
  await requireAdmin();
  const articleId = Math.floor(Number(formData.get("articleId")));
  const statusValue = String(formData.get("status") || "");
  const status: OriginalArticleStatus = statusValue === "hidden" ? "hidden" : statusValue === "draft" ? "draft" : "published";
  if (!Number.isSafeInteger(articleId) || articleId <= 0 || !setOriginalArticleStatus(articleId, status)) {
    noticePath(returnPath(formData), "文章不存在或状态未改变", "warning");
  }
  revalidatePath("/original");
  revalidatePath("/admin/original");
  noticePath(returnPath(formData), status === "published" ? "文章已发布" : status === "hidden" ? "文章已隐藏" : "文章已转为草稿");
}

function formIds(formData: FormData, name: string): number[] {
  return Array.from(new Set(formData.getAll(name).map((value) => Math.floor(Number(value))).filter((value) => Number.isSafeInteger(value) && value > 0))).slice(0, 200);
}

export async function deleteOriginalArticlesBatchAction(formData: FormData) {
  await requireAdmin();
  const ids = formIds(formData, "articleIds");
  const deleted = deleteOriginalArticles(ids);
  if (!deleted) noticePath(returnPath(formData), "请选择要删除的文章", "warning");
  revalidatePath("/original", "layout");
  revalidatePath("/admin/original", "layout");
  noticePath(returnPath(formData), `已删除 ${deleted} 篇文章`);
}

export async function deleteOriginalCommentsBatchAction(formData: FormData) {
  await requireAdmin();
  const ids = formIds(formData, "commentIds");
  const deleted = deleteOriginalComments(ids);
  if (!deleted) noticePath(returnPath(formData), "请选择要删除的评论", "warning");
  revalidatePath("/original", "layout");
  revalidatePath("/admin/original", "layout");
  const articleId = Math.floor(Number(formData.get("articleId")));
  revalidatePath(articlePath(articleId));
  noticePath(returnPath(formData), `已删除 ${deleted} 条评论`);
}

export async function setOriginalArticlePinnedAction(formData: FormData) {
  await requireAdmin();
  const articleId = Math.floor(Number(formData.get("articleId")));
  const pinned = String(formData.get("pinned")) === "1";
  if (!Number.isSafeInteger(articleId) || articleId <= 0 || !setOriginalArticlePinned(articleId, pinned)) {
    noticePath(returnPath(formData), pinned ? "只有已发布文章可以置顶，或状态未改变" : "文章不存在或置顶状态未改变", "warning");
  }
  revalidatePath("/original", "layout");
  revalidatePath("/admin/original");
  revalidatePath(articlePath(articleId));
  noticePath(returnPath(formData), pinned ? "文章已置顶" : "文章已取消置顶");
}

export async function updateOriginalArticleAdminAction(formData: FormData) {
  await requireAdmin();
  const articleId = Math.floor(Number(formData.get("articleId")));
  const path = articlePath(articleId);
  try {
    updateOriginalArticleAsAdmin({
      articleId,
      title: formData.get("title"),
      bodyMarkdown: formData.get("bodyMarkdown"),
      unlockSodaPrice: formData.get("unlockSodaPrice"),
      tags: formData.get("tags"),
    });
  } catch (error) {
    noticePath(path, actionError(error), "warning");
  }
  revalidatePath("/original");
  revalidatePath("/admin/original");
  revalidatePath(path);
  noticePath(path, "文章已保存");
}

export async function setOriginalCommentStatusAdminAction(formData: FormData) {
  await requireAdmin();
  const commentId = Math.floor(Number(formData.get("commentId")));
  const articleId = Math.floor(Number(formData.get("articleId")));
  const status = String(formData.get("status")) === "hidden" ? "hidden" : "published";
  if (!Number.isSafeInteger(commentId) || commentId <= 0 || !setOriginalCommentStatus(commentId, status)) {
    noticePath(articlePath(articleId), "评论不存在或状态未改变", "warning");
  }
  revalidatePath("/original");
  revalidatePath(articlePath(articleId));
  noticePath(articlePath(articleId), status === "hidden" ? "评论已隐藏" : "评论已恢复");
}
