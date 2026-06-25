"use server";

import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getClientIp } from "@/lib/admin-access";
import { getUserAvatarMaxBytes, getUserDailyRegistrationLimitPerIp, isUserLoginEnabled, isUserRegistrationEnabled } from "@/lib/config";
import { clearCurrentUserSession, getCurrentUser, hashUserPassword, loginUser } from "@/lib/user-auth";
import {
  clearReadingHistory,
  countTodayRegistrationsForIp,
  createUserRecord,
  deleteReadingHistoryItem,
  removeAvatarFile,
  normalizeUsername,
  updateUserAvatar,
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "@/lib/users";

function authNotice(pathname: string, message: string, tone: "success" | "warning" | "error" = "success"): never {
  redirect(`${pathname}?notice=${encodeURIComponent(message)}&tone=${tone}`);
}

function cleanText(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

export async function registerUserAction(formData: FormData) {
  if (!isUserRegistrationEnabled()) {
    authNotice("/register", "注册暂未开放", "warning");
  }

  const headerStore = await headers();
  const clientIp = getClientIp(headerStore);
  const dailyLimit = getUserDailyRegistrationLimitPerIp();
  if (dailyLimit > 0 && countTodayRegistrationsForIp(clientIp) >= dailyLimit) {
    authNotice("/register", `当前 IP 今日最多注册 ${dailyLimit} 个账号`, "warning");
  }

  const username = normalizeUsername(cleanText(formData, "username"));
  const displayName = cleanText(formData, "displayName") || username;
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  const usernameError = validateUsername(username);
  if (usernameError) {
    authNotice("/register", usernameError, "warning");
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    authNotice("/register", displayNameError, "warning");
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    authNotice("/register", passwordError, "warning");
  }
  if (password !== confirmPassword) {
    authNotice("/register", "两次输入的密码不一致", "warning");
  }

  try {
    createUserRecord({
      username,
      displayName,
      passwordHash: hashUserPassword(password),
      status: "active",
      registrationIp: clientIp,
    });
  } catch {
    authNotice("/register", "用户名已存在", "warning");
  }

  const result = await loginUser(username, password);
  if (!result.ok) {
    authNotice("/register", result.message, "warning");
  }
  redirect("/account");
}

export async function loginUserAction(formData: FormData) {
  if (!isUserLoginEnabled()) {
    authNotice("/login", "登录暂未开放", "warning");
  }

  const username = cleanText(formData, "username");
  const password = String(formData.get("password") || "");
  const result = await loginUser(username, password);
  if (!result.ok) {
    authNotice("/login", result.message, "warning");
  }
  redirect("/account");
}

export async function logoutUserAction() {
  await clearCurrentUserSession();
  redirect("/");
}

export async function uploadAvatarAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    authNotice("/account", "请选择头像图片", "warning");
  }

  const maxBytes = getUserAvatarMaxBytes();
  if (file.size > maxBytes) {
    authNotice("/account", `头像不能超过 ${(maxBytes / 1024 / 1024).toFixed(1)} MB`, "warning");
  }

  const extensionByType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  const extension = extensionByType[file.type];
  if (!extension) {
    authNotice("/account", "头像只支持 PNG、JPG、WebP 或 GIF", "warning");
  }

  const avatarDir = path.join(process.cwd(), "public", "avatars");
  fs.mkdirSync(avatarDir, { recursive: true });
  const fileName = `user-${user.id}-${Date.now()}${extension}`;
  const filePath = path.join(avatarDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  updateUserAvatar(user.id, `/avatars/${fileName}`);
  removeAvatarFile(user.avatarPath);
  revalidatePath("/account");
  authNotice("/account", "头像已更新");
}

export async function deleteHistoryItemAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const historyIds = formData
    .getAll("historyIds")
    .concat(formData.getAll("historyId"))
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (!historyIds.length) {
    authNotice("/account", "浏览记录不存在", "warning");
  }
  for (const historyId of historyIds) {
    deleteReadingHistoryItem(user.id, historyId);
  }
  revalidatePath("/account");
  authNotice("/account", `已删除 ${historyIds.length} 条浏览记录`);
}

export async function clearHistoryAction() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  clearReadingHistory(user.id);
  revalidatePath("/account");
  authNotice("/account", "浏览记录已清空");
}
