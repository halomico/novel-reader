"use server";

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getClientIp } from "@/lib/admin-access";
import {
  getUserAvatarMaxBytes,
  getUserDailyRegistrationLimitPerIp,
  getUserLoginCaptchaMode,
  isUserLoginEnabled,
  isUserRegistrationEnabled,
} from "@/lib/config";
import { verifyLoginCaptcha } from "@/lib/login-captcha";
import {
  clearCurrentUserSession,
  createUserSession,
  deleteUserSessions,
  getCurrentUser,
  hashUserPassword,
  loginUser,
  verifyUserPassword,
} from "@/lib/user-auth";
import {
  clearReadingHistory,
  countTodayRegistrationsForIp,
  createUserRecord,
  deleteReadingHistoryItem,
  getUserPasswordHashById,
  removeAvatarFile,
  normalizeUsername,
  updateUserDisplayName,
  updateUserPasswordHash,
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

function isUsernameConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username");
}

function avatarExtension(file: File): string | null {
  const type = file.type.toLowerCase();
  const byType: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  if (byType[type]) {
    return byType[type];
  }

  const extension = path.extname(file.name || "").toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg" || extension === ".jpe") {
    return ".jpg";
  }
  if (extension === ".png" || extension === ".webp" || extension === ".gif") {
    return extension;
  }
  return null;
}

function hasAvatarSignature(buffer: Buffer, extension: string): boolean {
  if (extension === ".jpg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === ".png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (extension === ".gif") {
    const signature = buffer.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  }
  if (extension === ".webp") {
    return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

export async function registerUserAction(formData: FormData) {
  if (!isUserRegistrationEnabled()) {
    authNotice("/register", "注册暂未开放", "warning");
  }

  const captchaMode = getUserLoginCaptchaMode();
  if (
    captchaMode !== "off" &&
    !verifyLoginCaptcha({
      id: cleanText(formData, "captchaId"),
      mode: captchaMode,
      purpose: "register",
      answer: String(formData.get("captchaAnswer") || ""),
    })
  ) {
    authNotice("/register", "验证码不正确或已过期，请重试", "warning");
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
  } catch (error) {
    if (isUsernameConflict(error)) {
      authNotice("/register", "用户名已存在", "warning");
    }
    console.error("Failed to create user", error);
    authNotice("/register", "账号创建失败，请稍后重试", "error");
  }

  if (!isUserLoginEnabled()) {
    authNotice("/login", "注册成功，登录暂未开放", "success");
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

  const captchaMode = getUserLoginCaptchaMode();
  if (
    captchaMode !== "off" &&
    !verifyLoginCaptcha({
      id: cleanText(formData, "captchaId"),
      mode: captchaMode,
      purpose: "login",
      answer: String(formData.get("captchaAnswer") || ""),
    })
  ) {
    authNotice("/login", "验证码不正确或已过期，请重试", "warning");
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

  const extension = avatarExtension(file);
  if (!extension) {
    authNotice("/account", "头像只支持 PNG、JPG/JPEG、WebP 或 GIF", "warning");
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    authNotice("/account", "头像读取失败，请重新选择图片", "error");
  }

  if (!hasAvatarSignature(buffer, extension)) {
    authNotice("/account", "头像文件内容不是有效的图片", "warning");
  }

  const avatarDir = path.join(process.cwd(), "public", "avatars");
  fs.mkdirSync(avatarDir, { recursive: true });
  const fileName = `user-${user.id}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${extension}`;
  const filePath = path.join(avatarDir, fileName);
  try {
    fs.writeFileSync(filePath, buffer, { flag: "wx" });
  } catch {
    authNotice("/account", "头像文件保存失败，请稍后重试", "error");
  }
  try {
    updateUserAvatar(user.id, `/avatars/${fileName}`);
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Keep the original database failure as the user-facing error.
    }
    console.error("Failed to update user avatar", error);
    authNotice("/account", "头像信息保存失败，请稍后重试", "error");
  }
  removeAvatarFile(user.avatarPath);
  revalidatePath("/account");
  authNotice("/account", "头像已更新");
}

export async function updateAccountDisplayNameAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const displayName = cleanText(formData, "displayName");
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    authNotice("/account", displayNameError, "warning");
  }

  updateUserDisplayName(user.id, displayName);
  revalidatePath("/account");
  authNotice("/account", "显示名称已更新");
}

export async function updateAccountPasswordAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    authNotice("/account", passwordError, "warning");
  }
  if (newPassword !== confirmPassword) {
    authNotice("/account", "两次输入的新密码不一致", "warning");
  }

  const passwordHash = getUserPasswordHashById(user.id);
  if (!passwordHash || !verifyUserPassword(currentPassword, passwordHash)) {
    authNotice("/account", "当前密码不正确", "warning");
  }

  updateUserPasswordHash(user.id, hashUserPassword(newPassword));
  deleteUserSessions(user.id);
  const headerStore = await headers();
  await createUserSession(user.id, getClientIp(headerStore), headerStore.get("user-agent") || "");
  revalidatePath("/account");
  authNotice("/account", "密码已更新");
}

export async function deleteHistoryItemAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const historyIds = Array.from(
    new Set(
      formData
        .getAll("historyIds")
        .concat(formData.getAll("historyId"))
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  );
  if (!historyIds.length) {
    authNotice("/account", "浏览记录不存在", "warning");
  }
  const deleted = historyIds.reduce((count, historyId) => count + Number(deleteReadingHistoryItem(user.id, historyId)), 0);
  if (!deleted) {
    authNotice("/account", "浏览记录不存在", "warning");
  }
  revalidatePath("/account");
  authNotice("/account", `已删除 ${deleted} 条浏览记录`);
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
