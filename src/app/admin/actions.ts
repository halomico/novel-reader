"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminAccessState } from "@/lib/admin-access";
import { persistBlockedIp } from "@/lib/admin-ban";
import { clearAdminSession, getAdminSession, setAdminSession, verifyAdminCredentials } from "@/lib/admin-auth";
import { recordAdminLogin } from "@/lib/admin-login-records";
import { checkAdminOperationLimit } from "@/lib/admin-operation-limit";
import {
  getAdminBookPageSize,
  getAdminIndexPageSize,
  getAdminLoginRateLimitPerMinute,
  getContentIndexHardLimitBytes,
  getContentIndexMaxSegments,
  getContentIndexSoftLimitBytes,
  getCatalogPageSize,
  getContentRateLimitPerMinute,
  getContentRateLimitWindowSeconds,
  getFrontendSearchConcurrencyLimit,
  getGlobalSearchMaxResults,
  getManualIndexMaxSegments,
  getSearchRateLimitPerMinute,
  getSearchResultsPageSize,
  getSearchShortQueryRateLimitPerMinute,
  isAdminLoginRateLimitEnabled,
  shouldAdminLoginRateLimitBan,
} from "@/lib/config";
import { deleteContentIndexTerm } from "@/lib/content-index";
import { getContentIndexDb } from "@/lib/content-index-db";
import { cancelContentJobs } from "@/lib/content-jobs";
import { deleteNovelIds } from "@/lib/novel-files";
import { checkRateLimit } from "@/lib/rate-limit";
import { readSiteSettings, type SiteSettings, writeSiteSettings } from "@/lib/site-settings";

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

  const session = await getAdminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const limitedMessage = checkAdminOperationLimit(access.clientIp, path);
  if (limitedMessage) {
    adminNotice(limitedMessage, "warning", path);
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

function numberField(formData: FormData, name: string, fallback: number, min: number, max: number): number {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value, min), max);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export async function loginAdminAction(formData: FormData) {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    loginNotice(access.reason || "当前请求不能访问后台");
  }

  if (isAdminLoginRateLimitEnabled()) {
    const limit = checkRateLimit({
      key: `admin-login:${access.clientIp}`,
      limit: getAdminLoginRateLimitPerMinute(),
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      const blocked = shouldAdminLoginRateLimitBan() && persistBlockedIp(access.clientIp);
      loginNotice(blocked ? "登录太频繁，当前 IP 已加入黑名单" : `登录太频繁，请 ${limit.retryAfterSeconds} 秒后再试`);
    }
  }

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  if (!verifyAdminCredentials(username, password)) {
    loginNotice("用户名或密码不正确，或后台密钥尚未配置");
  }

  await setAdminSession(username);
  try {
    recordAdminLogin(username, access.clientIp, headerStore.get("user-agent") || "");
  } catch {
    // 登录记录不能影响后台登录本身。
  }
  redirect("/admin");
}

export async function logoutAdminAction() {
  await clearAdminSession();
  redirect("/admin/login");
}

export async function cancelFrontendSearchJobsAction() {
  await requireAdminRequest("/admin/settings");
  cancelContentJobs("search");
  adminNotice("已请求停止所有前台全文搜索任务", "success", "/admin/settings");
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
  const adminUsername = String(formData.get("adminUsername") || "").trim();
  const newPassword = String(formData.get("newAdminPassword") || "");
  const confirmPassword = String(formData.get("confirmAdminPassword") || "");
  if (newPassword && newPassword !== confirmPassword) {
    adminNotice("两次输入的后台新密码不一致", "warning", "/admin/settings");
  }

  const softLimitGb = numberField(formData, "contentIndexSoftLimitGb", getContentIndexSoftLimitBytes() / 1024 ** 3, 0.1, 10);
  const hardLimitGb = numberField(formData, "contentIndexHardLimitGb", getContentIndexHardLimitBytes() / 1024 ** 3, softLimitGb, 10);
  const next: SiteSettings = {
    ...previous,
    siteName: String(formData.get("siteName") || "").trim(),
    siteTitle: String(formData.get("siteTitle") || "").trim(),
    settingsPreviewText: String(formData.get("settingsPreviewText") || "").trim(),
    adminUsername,
    adminPasswordSha256: newPassword ? sha256(newPassword) : previous.adminPasswordSha256,
    adminAllowedIps: String(formData.get("adminAllowedIps") || "").trim(),
    adminBlockedIps: String(formData.get("adminBlockedIps") || "").trim(),
    adminOutboundAllowedIps: String(formData.get("adminOutboundAllowedIps") || "").trim(),
    adminOutboundBlockedIps: String(formData.get("adminOutboundBlockedIps") || "").trim(),
    adminRateLimitPerMinute: intField(formData, "adminRateLimitPerMinute", previous.adminRateLimitPerMinute || 60, 1, 600),
    adminLoginRateLimitPerMinute: intField(formData, "adminLoginRateLimitPerMinute", previous.adminLoginRateLimitPerMinute || 6, 1, 120),
    adminLoginRateLimitEnabled: formData.get("adminLoginRateLimitEnabled") === "on",
    adminLoginRateLimitBanEnabled: formData.get("adminLoginRateLimitBanEnabled") === "on",
    adminOperationRateLimitEnabled: formData.get("adminOperationRateLimitEnabled") === "on",
    adminOperationRateLimitPerMinute: intField(
      formData,
      "adminOperationRateLimitPerMinute",
      previous.adminOperationRateLimitPerMinute || 60,
      1,
      600,
    ),
    adminOperationRateLimitBanEnabled: formData.get("adminOperationRateLimitBanEnabled") === "on",
    catalogPageSize: intField(formData, "catalogPageSize", previous.catalogPageSize || getCatalogPageSize(), 1, 100),
    searchResultsPageSize: intField(formData, "searchResultsPageSize", previous.searchResultsPageSize || getSearchResultsPageSize(), 1, 100),
    adminBookPageSize: intField(formData, "adminBookPageSize", previous.adminBookPageSize || getAdminBookPageSize(), 1, 200),
    adminIndexPageSize: intField(formData, "adminIndexPageSize", previous.adminIndexPageSize || getAdminIndexPageSize(), 1, 200),
    contentIndexMaxSegments: intField(formData, "contentIndexMaxSegments", previous.contentIndexMaxSegments || getContentIndexMaxSegments(), 1, 100000),
    globalSearchMaxResults: intField(formData, "globalSearchMaxResults", previous.globalSearchMaxResults || getGlobalSearchMaxResults(), 1, 1000),
    searchRateLimitPerMinute: intField(
      formData,
      "searchRateLimitPerMinute",
      previous.searchRateLimitPerMinute || getSearchRateLimitPerMinute(),
      1,
      120,
    ),
    searchShortQueryRateLimitPerMinute: intField(
      formData,
      "searchShortQueryRateLimitPerMinute",
      previous.searchShortQueryRateLimitPerMinute || getSearchShortQueryRateLimitPerMinute(),
      1,
      120,
    ),
    contentRateLimitPerMinute: intField(
      formData,
      "contentRateLimitPerMinute",
      previous.contentRateLimitPerMinute || getContentRateLimitPerMinute(),
      1,
      600,
    ),
    contentRateLimitWindowSeconds: intField(
      formData,
      "contentRateLimitWindowSeconds",
      previous.contentRateLimitWindowSeconds || getContentRateLimitWindowSeconds(),
      10,
      3600,
    ),
    contentBlockHeadlessBrowsers: formData.get("contentBlockHeadlessBrowsers") === "on",
    frontendAutoIndexEnabled: formData.get("frontendAutoIndexEnabled") === "on",
    frontendSearchConcurrencyLimit: intField(
      formData,
      "frontendSearchConcurrencyLimit",
      previous.frontendSearchConcurrencyLimit || getFrontendSearchConcurrencyLimit(),
      1,
      50,
    ),
    contentIndexSoftLimitBytes: Math.floor(softLimitGb * 1024 ** 3),
    contentIndexHardLimitBytes: Math.floor(hardLimitGb * 1024 ** 3),
    manualIndexMaxSegmentsEnabled: formData.get("manualIndexMaxSegmentsEnabled") === "on",
    manualIndexMaxSegments: intField(formData, "manualIndexMaxSegments", previous.manualIndexMaxSegments || getManualIndexMaxSegments(), 1, 1000000),
    adminTheme:
      formData.get("adminTheme") === "light" || formData.get("adminTheme") === "dark" || formData.get("adminTheme") === "system"
        ? (formData.get("adminTheme") as SiteSettings["adminTheme"])
        : "system",
    showProgressBars: formData.get("showProgressBars") === "on",
  };
  writeSiteSettings(next);
  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/indexes");
  if (adminUsername) {
    await setAdminSession(adminUsername);
  }
  adminNotice("后台设置已保存", "success", "/admin/settings");
}

export async function deleteContentIndexAction(formData: FormData) {
  await requireAdminRequest("/admin/indexes");
  const term = deleteContentIndexTerm(getContentIndexDb(), String(formData.get("term") || ""));
  revalidatePath("/admin/indexes");
  adminNotice(term ? `索引词“${term}”已删除` : "索引关键词不能为空", term ? "success" : "warning", "/admin/indexes");
}
