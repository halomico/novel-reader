"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import {
  ContentAccessInputError,
  deleteContentAccessPolicy,
  deleteContentAccessRule,
  saveContentAccessPolicy,
  saveContentAccessRule,
} from "@/lib/content-access";

function accessNotice(message: string, tone: "success" | "warning" | "error" = "success"): never {
  redirect(`/admin/access?notice=${encodeURIComponent(message)}&tone=${tone}`);
}

async function requireAdmin() {
  const headerStore = await headers();
  if (!getAdminAccessState(headerStore).allowed) {
    notFound();
  }
  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }
  return session;
}

function optionalExpiryMinutes(value: FormDataEntryValue | null): number | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const minutes = Number(text);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 525_600) {
    throw new ContentAccessInputError("持续时间应为 1 至 525600 分钟");
  }
  return Date.now() + minutes * 60_000;
}

export async function saveContentAccessRuleAction(formData: FormData) {
  const session = await requireAdmin();
  try {
    saveContentAccessRule({
      id: Number(formData.get("id") || 0),
      targetType: formData.get("targetType"),
      targetValue: formData.get("targetValue"),
      matchMode: formData.get("matchMode"),
      scope: formData.get("scope"),
      audience: formData.get("audience"),
      reason: formData.get("reason"),
      expiresAt: optionalExpiryMinutes(formData.get("durationMinutes")),
      enabled: formData.get("enabled") === "on",
      createdBy: session.username,
    });
  } catch (error) {
    accessNotice(error instanceof ContentAccessInputError ? error.message : "访问规则保存失败", "warning");
  }
  revalidatePath("/admin/access");
  accessNotice("访问规则已保存");
}

export async function deleteContentAccessRuleAction(formData: FormData) {
  await requireAdmin();
  const deleted = deleteContentAccessRule(Number(formData.get("id")));
  revalidatePath("/admin/access");
  accessNotice(deleted ? "访问规则已删除" : "访问规则已不存在", deleted ? "success" : "warning");
}

export async function saveContentAccessPolicyAction(formData: FormData) {
  await requireAdmin();
  try {
    saveContentAccessPolicy({
      id: Number(formData.get("id") || 0),
      name: formData.get("name"),
      enabled: formData.get("enabled") === "on",
      scope: formData.get("scope"),
      audience: formData.get("audience"),
      windowSeconds: Number(formData.get("windowMinutes") || 1) * 60,
      maxRequests: formData.get("maxRequests"),
      blockSeconds: Number(formData.get("blockMinutes") || 5) * 60,
    });
  } catch (error) {
    accessNotice(error instanceof ContentAccessInputError ? error.message : "频率规则保存失败", "warning");
  }
  revalidatePath("/admin/access");
  accessNotice("频率规则已保存");
}

export async function deleteContentAccessPolicyAction(formData: FormData) {
  await requireAdmin();
  const deleted = deleteContentAccessPolicy(Number(formData.get("id")));
  revalidatePath("/admin/access");
  accessNotice(deleted ? "频率规则已删除" : "频率规则已不存在", deleted ? "success" : "warning");
}
