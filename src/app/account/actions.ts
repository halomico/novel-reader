"use server";

import crypto from "node:crypto";
import { checkLoginAttempt, clearLoginFailures, recordLoginFailure } from "@/core/security/auth-rate-limit";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  accountAvatarMaxBytes,
  accountDailyRegistrationLimit,
  accountEmailVerificationRequired,
  accountLoginEnabled,
  accountRegistrationMode,
} from "@/core/config/account-settings";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { getTrustedClientIp } from "@/core/security/client-ip";
import { normalizeEmail, normalizeUsername, validateDisplayName, validateEmail, validatePassword, validateUsername } from "@/domains/identity/account-input";
import { removeUserAvatarFile } from "@/domains/identity/avatar-storage";
import {
  countPostgresRegistrationsForIpToday,
  findPostgresUserIdByEmail,
  getPostgresUserPasswordHash,
  registerPostgresUser,
  replacePostgresUserPassword,
  updatePostgresUserAvatar,
  updatePostgresUserDisplayName,
  updatePostgresUserEmail,
} from "@/domains/identity/postgres-account";
import { isGeneratedAvatarPath } from "@/lib/default-avatar-data";
import { isEmailVerificationConfigured, sendUserVerificationEmail } from "@/lib/email-verification";
import { verifyHumanRequest } from "@/lib/human-verification";
import { LOCALE_REQUEST_HEADER, normalizeLocale } from "@/lib/locale";
import { normalizeUserReturnPath } from "@/lib/return-path";
import { claimPostgresDailySoda } from "@/domains/identity/postgres-user-economy";
import {
  clearCurrentUserSession,
  createUserSession,
  getCurrentUser,
  hashUserPassword,
  loginUser,
  verifyUserPassword,
} from "@/lib/user-auth";

function authNotice(
  pathname: string,
  message: string,
  tone: "success" | "warning" | "error" = "success",
  values: Record<string, string> = {},
): never {
  const params = new URLSearchParams({ notice: message, tone, ...values });
  redirect(`${pathname}?${params.toString()}`);
}

function cleanText(formData: FormData, name: string): string {
  return String(formData.get(name) || "").trim();
}

function requestOrigin(headerStore: Awaited<ReturnType<typeof headers>>): string {
  const protocol = headerStore.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = headerStore.get("x-forwarded-host")?.split(",")[0]?.trim() || headerStore.get("host");
  return host ? `${protocol}://${host}` : process.env.SITE_URL || "";
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
  const returnTo = normalizeUserReturnPath(formData.get("returnTo"));
  const returnValues = { returnTo };
  const settings = await readPostgresSiteSettings();
  const registrationMode = accountRegistrationMode(settings);
  if (registrationMode === "closed") {
    authNotice("/register", "注册暂未开放", "warning", returnValues);
  }

  const headerStore = await headers();
  const clientIp = getTrustedClientIp(headerStore);
  const dailyLimit = accountDailyRegistrationLimit(settings);
  if (dailyLimit > 0 && await countPostgresRegistrationsForIpToday(database("web"), clientIp) >= dailyLimit) {
    authNotice("/register", `当前 IP 今日最多注册 ${dailyLimit} 个账号`, "warning", returnValues);
  }

  const username = normalizeUsername(cleanText(formData, "username"));
  const displayName = cleanText(formData, "displayName") || username;
  const email = normalizeEmail(cleanText(formData, "email"));
  const inviteCode = cleanText(formData, "inviteCode");
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  const usernameError = validateUsername(username);
  if (usernameError) {
    authNotice("/register", usernameError, "warning", returnValues);
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    authNotice("/register", displayNameError, "warning", returnValues);
  }
  const verificationRequired = accountEmailVerificationRequired(settings);
  if ((verificationRequired || email) && validateEmail(email)) {
    authNotice("/register", "请输入有效的邮箱地址", "warning", returnValues);
  }
  if (verificationRequired && !isEmailVerificationConfigured()) {
    authNotice("/register", "邮箱验证尚未配置，请联系管理员", "error", returnValues);
  }
  if (registrationMode === "invite" && !inviteCode) {
    authNotice("/register", "请输入邀请码", "warning", returnValues);
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    authNotice("/register", passwordError, "warning", returnValues);
  }
  if (password !== confirmPassword) {
    authNotice("/register", "两次输入的密码不一致", "warning", returnValues);
  }

  const verification = await verifyHumanRequest(formData, "register", clientIp);
  if (!verification.ok) {
    authNotice("/register", verification.message, "warning", returnValues);
  }

  const passwordHash = await hashUserPassword(password);
  let userId = 0;
  try {
    const created = await registerPostgresUser({
      username,
      displayName,
      email: email || null,
      passwordHash,
      status: verificationRequired ? "pending" : "active",
      localePreference: normalizeLocale(headerStore.get(LOCALE_REQUEST_HEADER)),
      registrationIp: clientIp,
      registrationMode,
      inviteCode,
      dailyLimit,
    });
    if (!created.ok) {
      const messages = {
        daily_limit: `当前 IP 今日最多注册 ${dailyLimit} 个账号`,
        invalid_invite: "邀请码无效或已失效",
        username_conflict: "用户名已存在",
        email_conflict: "邮箱已被使用",
      } as const;
      authNotice("/register", messages[created.reason], "warning", returnValues);
    }
    userId = created.userId;
  } catch (error) {
    console.error("Failed to create user", error);
    authNotice("/register", "账号创建失败，请稍后重试", "error", returnValues);
  }

  if (verificationRequired) {
    try {
      await sendUserVerificationEmail({
        userId,
        email,
        displayName,
        requestOrigin: requestOrigin(headerStore),
      });
      authNotice("/verify-email", "验证邮件已发送，请在 24 小时内完成验证", "success");
    } catch (error) {
      console.error("Failed to send verification email", error);
      authNotice("/verify-email", "账号已创建，但邮件发送失败，请稍后重新发送", "warning");
    }
  }

  if (!accountLoginEnabled(settings)) {
    authNotice("/login", "注册成功，登录暂未开放", "success", returnValues);
  }

  const result = await loginUser(username, password);
  if (!result.ok) {
    authNotice("/register", result.message, "warning", returnValues);
  }
  redirect(returnTo);
}

export async function loginUserAction(formData: FormData) {
  const returnTo = normalizeUserReturnPath(formData.get("returnTo"));
  if (!accountLoginEnabled(await readPostgresSiteSettings())) {
    authNotice("/login", "登录暂未开放", "warning", { returnTo });
  }

  const username = cleanText(formData, "username");
  const password = String(formData.get("password") || "");
  const rememberLogin = formData.get("rememberLogin") === "on";
  const loginValues = { username, remember: rememberLogin ? "1" : "0", returnTo };
  const headerStore = await headers();
  const clientIp = getTrustedClientIp(headerStore);
  const throttle = checkLoginAttempt(clientIp, username);
  if (!throttle.allowed) {
    authNotice("/login", `登录太频繁，请 ${throttle.retryAfterSeconds} 秒后再试`, "warning", loginValues);
  }
  const verification = await verifyHumanRequest(formData, "login", clientIp);
  if (!verification.ok) {
    authNotice("/login", verification.message, "warning", loginValues);
  }

  const result = await loginUser(username, password, rememberLogin);
  if (!result.ok) {
    recordLoginFailure(clientIp, username);
    authNotice("/login", result.message, "warning", loginValues);
  }
  clearLoginFailures(clientIp, username);
  redirect(returnTo);
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

  const maxBytes = accountAvatarMaxBytes(await readPostgresSiteSettings());
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
    if (!await updatePostgresUserAvatar(database("web"), user.id, `/avatars/${fileName}`)) {
      throw new Error("User no longer exists");
    }
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Keep the original database failure as the user-facing error.
    }
    console.error("Failed to update user avatar", error);
    authNotice("/account", "头像信息保存失败，请稍后重试", "error");
  }
  removeUserAvatarFile(user.avatarPath);
  revalidatePath("/account");
  authNotice("/account", "头像已更新");
}

/** Persist a locally generated avatar marker without accepting arbitrary paths. */
export async function selectDefaultAvatarAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const avatarPath = String(formData.get("avatarPath") || "");
  if (!isGeneratedAvatarPath(avatarPath)) {
    authNotice("/account", "默认头像无效，请重新选择", "warning");
  }
  if (!await updatePostgresUserAvatar(database("web"), user.id, avatarPath)) {
    authNotice("/account", "账号不存在或已注销", "error");
  }
  removeUserAvatarFile(user.avatarPath);
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

  await updatePostgresUserDisplayName(database("web"), user.id, displayName);
  revalidatePath("/account");
  authNotice("/account", "昵称已更新");
}

export async function updateAccountEmailAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  if (!isEmailVerificationConfigured()) {
    authNotice("/account", "邮件服务暂不可用", "warning");
  }

  const rawEmail = cleanText(formData, "email");
  if (!rawEmail) {
    await updatePostgresUserEmail(user.id, null);
    revalidatePath("/account");
    authNotice("/account", "邮箱已解绑", "success");
  }

  const emailError = validateEmail(rawEmail);
  if (emailError) {
    authNotice("/account", emailError, "warning");
  }

  const normalized = normalizeEmail(rawEmail);
  const existingUserId = await findPostgresUserIdByEmail(database("web"), normalized);
  if (existingUserId && existingUserId !== user.id) {
    authNotice("/account", "该邮箱已被其他账号使用", "warning");
  }

  const emailUpdate = await updatePostgresUserEmail(user.id, normalized);
  if (emailUpdate === "conflict") authNotice("/account", "该邮箱已被其他账号使用", "warning");
  if (emailUpdate === "not_found") authNotice("/account", "账号不存在或已注销", "error");

  try {
    const headerStore = await headers();
    const origin = headerStore.get("origin") || "";
    await sendUserVerificationEmail({
      userId: user.id,
      email: normalized,
      displayName: user.displayName,
      requestOrigin: origin,
    });
    revalidatePath("/account");
    authNotice("/account", "邮箱已更新，验证邮件已发送，请前往查收验证", "success");
  } catch (err) {
    console.error("Failed to send verification email:", err);
    revalidatePath("/account");
    authNotice("/account", "邮箱已保存，但验证邮件发送失败，请稍后重试", "warning");
  }
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

  const passwordHash = await getPostgresUserPasswordHash(database("web"), user.id);
  if (!passwordHash || !(await verifyUserPassword(currentPassword, passwordHash))) {
    authNotice("/account", "当前密码不正确", "warning");
  }

  if (!await replacePostgresUserPassword(user.id, await hashUserPassword(newPassword))) {
    authNotice("/account", "账号不存在或已注销", "error");
  }
  const headerStore = await headers();
  await createUserSession(user.id, getTrustedClientIp(headerStore), headerStore.get("user-agent") || "");
  revalidatePath("/account");
  authNotice("/account", "密码已更新", "success");
}

export async function claimDailySodaAction() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  const result = await claimPostgresDailySoda(user.id);
  if (!result.ok) {
    authNotice("/account", "签到失败，请稍后重试", "error", { view: "growth" });
  }
  revalidatePath("/account");
  authNotice(
    "/account",
    result.alreadyCheckedIn ? `今日已签到，获得 ${result.reward} 苏打` : `签到成功，获得 ${result.reward} 苏打`,
    "success",
    { view: "growth", checkin: "1" },
  );
}
