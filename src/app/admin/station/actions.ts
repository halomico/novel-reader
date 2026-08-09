"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { mutationResult, type MutationResult } from "@/lib/mutation-result";
import { deleteContentReport, setContentReportStatus } from "@/lib/reports";
import {
  addStationReply,
  createAdminStationThread,
  deleteAnnouncement,
  deleteStationThread,
  listStationMessages,
  findStationRecipientId,
  saveAnnouncement,
  setStationThreadStatus,
  StationInputError,
  type Announcement,
  type StationMessage,
} from "@/lib/station";

async function requireAdmin() {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed) notFound();
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

export async function createAdminStationThreadInlineAction(
  usernameValue: string,
  subjectValue: string,
  bodyValue: string,
): Promise<MutationResult<{ threadId: number }>> {
  await requireAdmin();
  const userId = findStationRecipientId(usernameValue);
  if (!userId) return mutationResult(false, "用户不存在或不可用", "warning");
  try {
    const threadId = createAdminStationThread(userId, subjectValue, bodyValue);
    revalidatePath("/messages");
    return mutationResult(true, "消息已发送", "success", { threadId });
  } catch (error) {
    return mutationResult(false, stationError(error, "消息发送失败"), "warning");
  }
}

function optionalDate(value: FormDataEntryValue | null): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function stationError(error: unknown, fallback: string): string {
  if (error instanceof StationInputError) return error.message;
  console.error(fallback, error);
  return fallback;
}

export async function saveAnnouncementInlineAction(
  formData: FormData,
): Promise<MutationResult<{ announcement: Announcement }>> {
  await requireAdmin();
  try {
    const announcement = saveAnnouncement({
      id: Number(formData.get("id") || 0),
      title: formData.get("title"),
      body: formData.get("body"),
      audience: formData.get("audience"),
      importance: formData.get("importance"),
      displayMode: formData.get("displayMode"),
      status: formData.get("status") === "archived" ? "archived" : "published",
      publishedAt: optionalDate(formData.get("publishedAt")),
      expiresAt: optionalDate(formData.get("expiresAt")),
    });
    revalidatePath("/");
    revalidatePath("/announcements");
    revalidatePath("/messages");
    return mutationResult(
      true,
      announcement.status === "published" ? "公告已发布" : "公告已下线",
      "success",
      { announcement },
    );
  } catch (error) {
    return mutationResult(false, stationError(error, "公告保存失败"), "warning");
  }
}

export async function deleteAnnouncementInlineAction(idValue: number): Promise<MutationResult> {
  await requireAdmin();
  const deleted = deleteAnnouncement(Math.floor(Number(idValue)));
  if (!deleted) return mutationResult(false, "公告不存在", "warning");
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath("/messages");
  return mutationResult(true, "公告已删除", "success");
}

export async function deleteStationThreadInlineAction(idValue: number): Promise<MutationResult> {
  await requireAdmin();
  const deleted = deleteStationThread(Math.floor(Number(idValue)));
  if (!deleted) return mutationResult(false, "留言不存在", "warning");
  revalidatePath("/messages");
  return mutationResult(true, "留言已删除", "success");
}

export async function replyStationThreadInlineAction(
  threadIdValue: number,
  bodyValue: string,
): Promise<MutationResult<{ messages: StationMessage[] }>> {
  await requireAdmin();
  const threadId = Math.floor(Number(threadIdValue));
  try {
    const replied = addStationReply({ threadId, body: bodyValue, authorRole: "admin" });
    if (!replied) return mutationResult(false, "该留言已结束", "warning");
    revalidatePath("/messages");
    return mutationResult(true, "回复已发送", "success", {
      messages: listStationMessages(threadId),
    });
  } catch (error) {
    return mutationResult(false, stationError(error, "回复发送失败"), "warning");
  }
}

export async function setStationThreadStatusInlineAction(
  threadIdValue: number,
  status: "open" | "closed",
): Promise<MutationResult<{ status: "open" | "closed" }>> {
  await requireAdmin();
  const threadId = Math.floor(Number(threadIdValue));
  if (!setStationThreadStatus(threadId, status)) {
    return mutationResult(false, "留言不存在", "warning");
  }
  revalidatePath("/messages");
  return mutationResult(
    true,
    status === "open" ? "留言已重新打开" : "留言已结束",
    "success",
    { status },
  );
}

export async function setContentReportStatusInlineAction(
  reportIdValue: number,
  status: "open" | "resolved",
): Promise<MutationResult<{ status: "open" | "resolved" }>> {
  const session = await requireAdmin();
  const reportId = Math.floor(Number(reportIdValue));
  if (!setContentReportStatus(reportId, status, session.username)) {
    return mutationResult(false, "反馈记录不存在", "warning");
  }
  return mutationResult(
    true,
    status === "resolved" ? "反馈已处理" : "反馈已重新打开",
    "success",
    { status },
  );
}

export async function deleteContentReportInlineAction(idValue: number): Promise<MutationResult> {
  await requireAdmin();
  const deleted = deleteContentReport(Math.floor(Number(idValue)));
  return deleted
    ? mutationResult(true, "反馈记录已删除", "success")
    : mutationResult(false, "反馈记录不存在", "warning");
}
