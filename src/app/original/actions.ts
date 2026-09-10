"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addOriginalComment,
  deleteOriginalComment,
  OriginalInputError,
  purchaseOriginalArticle,
  updateOriginalComment,
} from "@/domains/originals/postgres-originals";
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

export async function purchaseOriginalArticleAction(formData: FormData) {
  const user = await getCurrentUser();
  const slug = String(formData.get("slug") || "");
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(`/original/${slug}`)}`);
  try {
    await purchaseOriginalArticle(Number(formData.get("articleId")), user.id);
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
    const result = await addOriginalComment(Number(formData.get("articleId")), user, formData.get("bodyMarkdown"));
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
    const result = await updateOriginalComment(
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
  let result: Awaited<ReturnType<typeof deleteOriginalComment>>;
  try {
    result = await deleteOriginalComment(commentId, user.id);
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
