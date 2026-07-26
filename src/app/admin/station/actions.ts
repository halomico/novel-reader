"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  addStationReply,
  deleteAnnouncement,
  deleteStationThread,
  saveAnnouncement,
  setStationThreadStatus,
  StationInputError,
} from "@/lib/station";
import { deleteContentReport } from "@/lib/reports";

function safeReturnPath(formData: FormData): string {
  const path = String(formData.get("returnPath") || "/admin/station");
  return path === "/admin/station" || (path.startsWith("/admin/station?") && !/[\r\n#\\]/.test(path))
    ? path
    : "/admin/station";
}

function stationNotice(
  message: string,
  tone: "success" | "warning" | "error" = "success",
  returnPath = "/admin/station",
): never {
  const separator = returnPath.includes("?") ? "&" : "?";
  redirect(`${returnPath}${separator}notice=${encodeURIComponent(message)}&tone=${tone}`);
}

async function requireAdmin() {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed) notFound();
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

function optionalDate(value: FormDataEntryValue | null): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export async function saveAnnouncementAction(formData: FormData) {
  await requireAdmin();
  const returnPath = safeReturnPath(formData);
  try {
    saveAnnouncement({
      id: Number(formData.get("id") || 0),
      title: formData.get("title"),
      body: formData.get("body"),
      audience: formData.get("audience"),
      importance: formData.get("importance"),
      status: formData.get("status"),
      publishedAt: optionalDate(formData.get("publishedAt")),
      expiresAt: optionalDate(formData.get("expiresAt")),
    });
  } catch (error) {
    stationNotice(error instanceof StationInputError ? error.message : "公告保存失败", "warning", returnPath);
  }
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath("/messages");
  revalidatePath("/admin/station");
  stationNotice("公告已保存", "success", returnPath);
}

export async function deleteAnnouncementAction(formData: FormData) {
  await requireAdmin();
  const deleted = deleteAnnouncement(Number(formData.get("id")));
  revalidatePath("/");
  revalidatePath("/announcements");
  revalidatePath("/messages");
  revalidatePath("/admin/station");
  stationNotice(deleted ? "公告已删除" : "公告已不存在", deleted ? "success" : "warning", "/admin/station?view=announcements");
}

export async function deleteStationThreadAction(formData: FormData) {
  await requireAdmin();
  const deleted = deleteStationThread(Number(formData.get("threadId")));
  revalidatePath("/messages");
  revalidatePath("/admin/station");
  stationNotice(deleted ? "留言已删除" : "留言已不存在", deleted ? "success" : "warning", "/admin/station");
}

export async function deleteContentReportAction(formData: FormData) {
  await requireAdmin();
  const deleted = deleteContentReport(Number(formData.get("reportId")));
  revalidatePath("/admin/station");
  stationNotice(
    deleted ? "举报记录已删除" : "举报记录已不存在",
    deleted ? "success" : "warning",
    safeReturnPath(formData),
  );
}

export async function replyStationThreadAdminAction(formData: FormData) {
  await requireAdmin();
  const threadId = Number(formData.get("threadId"));
  const returnPath = safeReturnPath(formData);
  try {
    const replied = addStationReply({ threadId, body: formData.get("body"), authorRole: "admin" });
    revalidatePath("/messages");
    revalidatePath("/admin/station");
    stationNotice(replied ? "回复已发送" : "该留言已关闭", replied ? "success" : "warning", returnPath);
  } catch (error) {
    stationNotice(error instanceof StationInputError ? error.message : "回复发送失败", "warning", returnPath);
  }
}

export async function setStationThreadStatusAction(formData: FormData) {
  await requireAdmin();
  const threadId = Number(formData.get("threadId"));
  const status = formData.get("status") === "open" ? "open" : "closed";
  const changed = setStationThreadStatus(threadId, status);
  revalidatePath("/messages");
  revalidatePath("/admin/station");
  stationNotice(
    changed ? (status === "open" ? "留言已重新打开" : "留言已结束") : "留言不存在",
    changed ? "success" : "warning",
    safeReturnPath(formData),
  );
}
