"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { clearAdminSession, getAdminSession, setAdminSession, verifyAdminCredentials } from "@/lib/admin-auth";
import { getAdminLoginRateLimitPerMinute, getAdminRateLimitPerMinute } from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { deleteNovelIds } from "@/lib/novel-files";
import { readSiteSettings, SiteSettings, writeSiteSettings } from "@/lib/site-settings";
import { persistBlockedIp } from "@/lib/admin-ban";

function adminNotice(message: string, tone: "success" | "warning" | "error" = "success", path = "/admin/books") {
  redirect(`${path}?notice=${encodeURIComponent(message)}&tone=${tone}`);
}

function loginNotice(message: string) {
  redirect(`/admin/login?error=${encodeURIComponent(message)}`);
}

async function requireAdminRequest(path = "/admin/books") {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    adminNotice(access.reason || "当前请求不能访问后台", "error", path);
  }

  const limit = checkRateLimit({
    key: `admin:${access.clientIp}`,
    limit: getAdminRateLimitPerMinute(),
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    const blocked = persistBlockedIp(access.clientIp);
    adminNotice(blocked ? "后台操作太频繁，当前 IP 已加入黑名单" : `后台操作太频繁，请 ${limit.retryAfterSeconds} 秒后再试`, "warning", path);
  }

  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  return session;
}

function intField(formData: FormData, name: string, fallback: number, min: number, max: number): number {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

export async function loginAdminAction(formData: FormData) {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    loginNotice(access.reason || "当前请求不能访问后台");
  }

  const limit = checkRateLimit({
    key: `admin-login:${access.clientIp}`,
    limit: getAdminLoginRateLimitPerMinute(),
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    const blocked = persistBlockedIp(access.clientIp);
    loginNotice(blocked ? "登录太频繁，当前 IP 已加入黑名单" : `登录太频繁，请 ${limit.retryAfterSeconds} 秒后再试`);
  }

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  if (!verifyAdminCredentials(username, password)) {
    loginNotice("用户名或密码不正确，或后台密钥尚未配置");
  }

  await setAdminSession(username);
  redirect("/admin");
}

export async function logoutAdminAction() {
  await clearAdminSession();
  redirect("/admin/login");
}

export async function deleteNovelsAction(formData: FormData) {
  await requireAdminRequest();
  const ids = formData
    .getAll("bookIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (ids.length === 0) {
    adminNotice("请选择要删除的小说", "warning");
  }

  const deleted = deleteNovelIds(ids);
  revalidatePath("/");
  revalidatePath("/admin/books");
  adminNotice(`已删除 ${deleted} 本小说`, deleted ? "success" : "warning");
}

export async function saveAdminSettingsAction(formData: FormData) {
  await requireAdminRequest("/admin/settings");
  const previous = readSiteSettings();
  const next: SiteSettings = {
    ...previous,
    siteName: String(formData.get("siteName") || "").trim(),
    siteTitle: String(formData.get("siteTitle") || "").trim(),
    settingsPreviewText: String(formData.get("settingsPreviewText") || "").trim(),
    adminAllowedIps: String(formData.get("adminAllowedIps") || "").trim(),
    adminBlockedIps: String(formData.get("adminBlockedIps") || "").trim(),
    adminOutboundAllowedIps: String(formData.get("adminOutboundAllowedIps") || "").trim(),
    adminOutboundBlockedIps: String(formData.get("adminOutboundBlockedIps") || "").trim(),
    adminRateLimitPerMinute: intField(formData, "adminRateLimitPerMinute", previous.adminRateLimitPerMinute || 60, 1, 600),
    adminLoginRateLimitPerMinute: intField(formData, "adminLoginRateLimitPerMinute", previous.adminLoginRateLimitPerMinute || 6, 1, 120),
    adminTheme:
      formData.get("adminTheme") === "light" || formData.get("adminTheme") === "dark" || formData.get("adminTheme") === "system"
        ? (formData.get("adminTheme") as SiteSettings["adminTheme"])
        : "system",
  };
  writeSiteSettings(next);
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath("/admin/settings");
  adminNotice("后台设置已保存", "success", "/admin/settings");
}
