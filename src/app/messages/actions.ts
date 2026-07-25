"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addStationReply, createStationThread, StationInputError } from "@/lib/station";
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
  try {
    const threadId = createStationThread(user.id, formData.get("subject"), formData.get("body"));
    revalidatePath("/messages");
    messageNotice("留言已发送", "success", threadId);
  } catch (error) {
    messageNotice(error instanceof StationInputError ? error.message : "留言发送失败", "warning");
  }
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
  try {
    const replied = addStationReply({
      threadId,
      body: formData.get("body"),
      authorRole: "user",
      userId: user.id,
    });
    revalidatePath("/messages");
    messageNotice(replied ? "回复已发送" : "该留言已关闭", replied ? "success" : "warning", threadId);
  } catch (error) {
    messageNotice(error instanceof StationInputError ? error.message : "回复发送失败", "warning", threadId);
  }
}
