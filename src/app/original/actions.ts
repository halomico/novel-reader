"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addOriginalComment,
  createOriginalArticle,
  deleteOriginalComment,
  OriginalInputError,
  purchaseOriginalArticle,
  updateOriginalComment,
  updateOriginalArticle,
} from "@/lib/original";
import { getCurrentUser } from "@/lib/user-auth";

function messagePath(pathname: string, message: string, tone: "warning" | "success" = "warning"): never {
  const params = new URLSearchParams({ notice: message, tone });
  redirect(`${pathname}${pathname.includes("?") ? "&" : "?"}${params.toString()}`);
}

function errorText(error: unknown): string {
  if (error instanceof OriginalInputError) return error.message;
  console.error("Original channel action failed", error);
  return "操作失败，请稍后重试";
}

export async function createOriginalArticleAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Foriginal%2Fnew");
  let article: ReturnType<typeof createOriginalArticle>;
  try {
    article = createOriginalArticle({
      author: user,
      title: formData.get("title"),
      bodyMarkdown: formData.get("bodyMarkdown"),
      unlockSodaPrice: formData.get("unlockSodaPrice"),
      tags: formData.get("tags"),
    });
  } catch (error) {
    messagePath("/original/new", errorText(error));
  }
  revalidatePath("/original");
  redirect(`/original/${encodeURIComponent(article.slug)}?notice=${encodeURIComponent("文章已发布")}&tone=success`);
}

export async function updateOriginalArticleAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Foriginal");
  const articleId = Number(formData.get("articleId"));
  const slug = String(formData.get("slug") || "");
  try {
    updateOriginalArticle({
      articleId,
      author: user,
      title: formData.get("title"),
      bodyMarkdown: formData.get("bodyMarkdown"),
      unlockSodaPrice: formData.get("unlockSodaPrice"),
      tags: formData.get("tags"),
    });
  } catch (error) {
    messagePath(`/original/${encodeURIComponent(slug)}/edit`, errorText(error));
  }
  revalidatePath("/original");
  revalidatePath(`/original/${slug}`);
  redirect(`/original/${encodeURIComponent(slug)}?notice=${encodeURIComponent("文章已更新")}&tone=success`);
}

export async function purchaseOriginalArticleAction(formData: FormData) {
  const user = await getCurrentUser();
  const slug = String(formData.get("slug") || "");
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/original/${slug}`)}`);
  try {
    purchaseOriginalArticle(Number(formData.get("articleId")), user.id);
  } catch (error) {
    messagePath(`/original/${encodeURIComponent(slug)}`, errorText(error));
  }
  revalidatePath(`/original/${slug}`);
  redirect(`/original/${encodeURIComponent(slug)}?notice=${encodeURIComponent("文章已解锁")}&tone=success`);
}

export type OriginalCommentActionState = {
  ok: boolean;
  message: string;
  version: number;
  remainingFree?: number | null;
};

export async function addOriginalCommentAction(
  previous: OriginalCommentActionState,
  formData: FormData,
): Promise<OriginalCommentActionState> {
  const user = await getCurrentUser();
  const slug = String(formData.get("slug") || "");
  if (!user) return { ok: false, message: "登录已失效，请重新登录", version: previous.version + 1 };
  try {
    const result = addOriginalComment(Number(formData.get("articleId")), user, formData.get("bodyMarkdown"));
    revalidatePath(`/original/${slug}`);
    revalidatePath("/original/mine");
    return {
      ok: true,
      message: result.chargedSoda > 0 ? "回复已发布，已扣除 1 苏打" : "回复已发布",
      version: previous.version + 1,
      remainingFree: result.remainingFree,
    };
  } catch (error) {
    return { ok: false, message: errorText(error), version: previous.version + 1 };
  }
}

export async function updateOwnOriginalCommentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Foriginal%2Fmine%3Fview%3Dcomments");
  let chargedSoda = 0;
  try {
    const result = updateOriginalComment(
      Math.floor(Number(formData.get("commentId"))),
      user.id,
      formData.get("bodyMarkdown"),
    );
    chargedSoda = result.chargedSoda;
  } catch (error) {
    messagePath("/original/mine?view=comments", errorText(error));
  }
  revalidatePath("/original");
  revalidatePath("/original/mine");
  const params = new URLSearchParams({
    view: "comments",
    notice: chargedSoda ? "回复已更新，已扣除 1 苏打" : "回复已更新",
    tone: "success",
  });
  redirect(`/original/mine?${params.toString()}`);
}

export async function deleteOwnOriginalCommentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Foriginal%2Fmine%3Fview%3Dcomments");
  const commentId = Math.floor(Number(formData.get("commentId")));
  let result: ReturnType<typeof deleteOriginalComment>;
  try {
    result = deleteOriginalComment(commentId, user.id);
  } catch (error) {
    messagePath("/original/mine?view=comments", errorText(error));
  }
  if (!result) {
    messagePath("/original/mine?view=comments", "回复不存在或没有删除权限");
  }
  revalidatePath("/original");
  revalidatePath("/original/mine");
  const params = new URLSearchParams({
    view: "comments",
    notice: result.chargedSoda ? "回复已删除，已扣除 1 苏打" : "回复已删除",
    tone: "success",
  });
  redirect(`/original/mine?${params.toString()}`);
}
