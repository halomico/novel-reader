"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addStationReply, createStationThread, StationInputError } from "@/lib/station";
import { listStationMessages } from "@/lib/station";
import { mutationResult, type MutationResult } from "@/lib/mutation-result";
import { unlinkTelegramUser } from "@/lib/telegram-links";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";

function messageNotice(message: string, tone: "success" | "warning" = "success", threadId?: number): never {
  const params = new URLSearchParams({ tab: "station", notice: message, tone });
  if (threadId) params.set("thread", String(threadId));
  redirect(`/messages?${params.toString()}`);
}

export async function createStationThreadAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (!hasUserPermission(user, "station_message")) {
    messageNotice("当前等级暂不能发送站务消息", "warning");
  }
  let threadId: number;
  try {
    threadId = createStationThread(user.id, formData.get("subject"), formData.get("body"));
  } catch (error) {
    messageNotice(error instanceof StationInputError ? error.message : "留言发送失败", "warning");
  }
  revalidatePath("/messages");
  redirect(`/messages?tab=station&thread=${threadId}`);
}

export async function replyStationThreadAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const threadId = Number(formData.get("threadId"));
  if (!hasUserPermission(user, "station_message")) {
    messageNotice("当前等级暂不能回复站务消息", "warning", threadId);
  }
  let replied: boolean;
  try {
    replied = addStationReply({
      threadId,
      body: formData.get("body"),
      authorRole: "user",
      userId: user.id,
    });
  } catch (error) {
    messageNotice(error instanceof StationInputError ? error.message : "回复发送失败", "warning", threadId);
  }
  revalidatePath("/messages");
  messageNotice(replied ? "回复已发送" : "该留言已关闭", replied ? "success" : "warning", threadId);
}

export async function replyStationThreadInlineAction(
  threadIdValue: number,
  bodyValue: string,
): Promise<MutationResult<{ messages: ReturnType<typeof listStationMessages>; status: "open" | "closed" }>> {
  const user = await getCurrentUser();
  if (!user) return mutationResult(false, "请先登录", "warning");
  const threadId = Math.floor(Number(threadIdValue));
  if (!hasUserPermission(user, "station_message")) {
    return mutationResult(false, "当前等级暂不能回复站务消息", "warning");
  }
  try {
    const replied = addStationReply({ threadId, body: bodyValue, authorRole: "user", userId: user.id });
    if (!replied) return mutationResult(false, "该留言已关闭", "warning");
    revalidatePath("/messages");
    return mutationResult(true, "消息已发送", "success", {
      messages: listStationMessages(threadId),
      status: "open",
    });
  } catch (error) {
    return mutationResult(false, error instanceof StationInputError ? error.message : "回复发送失败", "warning");
  }
}

export async function unlinkTelegramAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  unlinkTelegramUser(user.id);
  revalidatePath("/messages");
  messageNotice("Telegram 已断开", "success");
}
