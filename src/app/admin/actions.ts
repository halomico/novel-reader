"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
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
  getFrontendSearchConcurrencyLimit,
  getGlobalSearchMaxResults,
  getManualIndexMaxSegments,
  getNoticeDisplaySeconds,
  getSearchResultsPageSize,
  getUserDailyRegistrationLimitPerIp,
  isAdminLoginRateLimitEnabled,
  getUserAvatarMaxBytes,
  getUserSearchRateLimitPerMinute,
  shouldAdminLoginRateLimitBan,
} from "@/lib/config";
import { deleteContentIndexTerm } from "@/lib/content-index";
import { getContentIndexDb } from "@/lib/content-index-db";
import { cancelContentJobs } from "@/lib/content-jobs";
import { deleteIpRateLimitBans, parseIpRateLimitBanKey, type IpRateLimitBanKey } from "@/lib/ip-rate-limit";
import {
  createMediaFolder,
  deleteMediaAssets,
  deleteMediaFolder,
  getMediaAsset,
  isMediaKind,
  MediaFolderError,
  renameMediaFolder,
  syncMediaLibrary,
  updateMediaAsset,
} from "@/lib/media";
import { clearMediaThumbnails } from "@/lib/media-thumbnail";
import { deleteNovelIds } from "@/lib/novel-files";
import { hashPassword } from "@/lib/password";
import { checkRateLimit } from "@/lib/rate-limit";
import { detectSiteIconFormat, MAX_SITE_ICON_BYTES, removeSiteIconFile, writeSiteIconFile } from "@/lib/site-icon";
import { normalizeIpRateLimitRules, readSiteSettings, type SiteSettings, writeSiteSettings } from "@/lib/site-settings";
import { deleteUserSessions, hashUserPassword } from "@/lib/user-auth";
import {
  clearBrowseHistory,
  createUserRecord,
  deleteBrowseHistoryItem,
  deleteUserIds,
  updateUserRecord,
  updateUserStatus,
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "@/lib/users";

function adminNotice(message: string, tone: "success" | "warning" | "error" = "success", path = "/admin/books"): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}notice=${encodeURIComponent(message)}&tone=${tone}`);
}

function mediaReturnPath(formData: FormData): string {
  const requested = String(formData.get("returnPath") || "");
  return requested === "/admin/media" || (requested.startsWith("/admin/media?") && !/[\r\n#]/.test(requested)) ? requested : "/admin/media";
}

function mediaFolderMessage(error: unknown): string {
  return error instanceof MediaFolderError ? error.message : "文件夹操作失败，请检查媒体目录权限";
}

function loginNotice(message: string): never {
  redirect(`/admin/login?error=${encodeURIComponent(message)}`);
}

async function requireAdminRequest(path = "/admin/books") {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    notFound();
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

function optionalIntField(formData: FormData, name: string, min: number, max: number): number | null {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) {
    return null;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function mediaAccessModeField(formData: FormData, name: string): "off" | "user" | "public" {
  const value = formData.get(name);
  return value === "user" || value === "public" ? value : "off";
}

function rateLimitRulesField(formData: FormData, name: string, label: string): SiteSettings["searchRateLimitRules"] {
  let rules: SiteSettings["searchRateLimitRules"] = [];
  try {
    rules = normalizeIpRateLimitRules(JSON.parse(String(formData.get(name) || "[]")));
  } catch {
    adminNotice(`${label}规则格式无效`, "warning", "/admin/settings");
  }
  if (rules.length === 0) {
    adminNotice(`至少保留一条${label}规则`, "warning", "/admin/settings");
  }
  return rules;
}

function isUsernameConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed: users.username");
}

export async function loginAdminAction(formData: FormData) {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    notFound();
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

export async function uploadSiteIconAction(formData: FormData) {
  await requireAdminRequest("/admin/settings");
  const file = formData.get("siteIcon");
  if (!(file instanceof File) || file.size === 0) {
    adminNotice("请选择站点图标文件", "warning", "/admin/settings");
  }
  if (file.size > MAX_SITE_ICON_BYTES) {
    adminNotice("站点图标不能超过 15 MB", "warning", "/admin/settings");
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    adminNotice("站点图标读取失败", "error", "/admin/settings");
  }
  if (!detectSiteIconFormat(buffer)) {
    adminNotice("图标只支持 PNG、JPG、WebP 或 ICO", "warning", "/admin/settings");
  }

  let stored: ReturnType<typeof writeSiteIconFile>;
  try {
    stored = writeSiteIconFile(buffer);
  } catch {
    adminNotice("站点图标文件保存失败，请检查数据目录权限和磁盘空间", "error", "/admin/settings");
  }

  const previous = readSiteSettings();
  try {
    writeSiteSettings({
      ...previous,
      siteIconFileName: stored.fileName,
      siteIconMimeType: stored.mimeType,
      siteIconUpdatedAt: stored.updatedAt,
    });
  } catch {
    removeSiteIconFile(stored.fileName);
    adminNotice("站点图标保存失败", "error", "/admin/settings");
  }
  if (previous.siteIconFileName && previous.siteIconFileName !== stored.fileName) {
    removeSiteIconFile(previous.siteIconFileName);
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  adminNotice("站点图标已更新", "success", "/admin/settings");
}

export async function deleteSiteIconAction() {
  await requireAdminRequest("/admin/settings");
  const previous = readSiteSettings();
  try {
    writeSiteSettings({
      ...previous,
      siteIconFileName: "",
      siteIconMimeType: "",
      siteIconUpdatedAt: "",
    });
  } catch (error) {
    console.error("Failed to clear site icon settings", error);
    adminNotice("站点图标删除失败，请检查数据目录权限", "error", "/admin/settings");
  }
  if (previous.siteIconFileName) {
    removeSiteIconFile(previous.siteIconFileName);
  }
  revalidatePath("/", "layout");
  revalidatePath("/admin/settings");
  adminNotice(previous.siteIconFileName ? "站点图标已删除" : "当前没有自定义站点图标", previous.siteIconFileName ? "success" : "warning", "/admin/settings");
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

  const result = deleteNovelIds(ids);
  revalidatePath("/");
  revalidatePath("/admin/books");
  if (result.fileDeleteFailures.length) {
    adminNotice(
      `已删除 ${result.deleted} 条记录，但有 ${result.fileDeleteFailures.length} 个原文件未能删除，下次扫描可能重新出现`,
      "warning",
    );
  }
  adminNotice(`已删除 ${result.deleted} 本小说`, result.deleted ? "success" : "warning");
}

export async function saveAdminSettingsAction(formData: FormData) {
  await requireAdminRequest("/admin/settings");
  const previous = readSiteSettings();
  const adminUsername = String(formData.get("adminUsername") || "").trim();
  const newPassword = String(formData.get("newAdminPassword") || "");
  const confirmPassword = String(formData.get("confirmAdminPassword") || "");
  if (!adminUsername) {
    adminNotice("后台用户名不能为空", "warning", "/admin/settings");
  }
  if (newPassword && newPassword !== confirmPassword) {
    adminNotice("两次输入的后台新密码不一致", "warning", "/admin/settings");
  }
  const adminPasswordError = newPassword ? validatePassword(newPassword) : null;
  if (adminPasswordError) {
    adminNotice(`后台${adminPasswordError}`, "warning", "/admin/settings");
  }

  const softLimitGb = numberField(formData, "contentIndexSoftLimitGb", getContentIndexSoftLimitBytes() / 1024 ** 3, 0.1, 10);
  const hardLimitGb = numberField(formData, "contentIndexHardLimitGb", getContentIndexHardLimitBytes() / 1024 ** 3, softLimitGb, 10);
  const userAvatarMaxMb = numberField(formData, "userAvatarMaxMb", getUserAvatarMaxBytes() / 1024 ** 2, 0.1, 10);
  const searchRateLimitRules = rateLimitRulesField(formData, "searchRateLimitRules", "搜索限速");
  const contentRateLimitRules = rateLimitRulesField(formData, "contentRateLimitRules", "正文限速").map((rule) => ({
    ...rule,
    scope: "all" as const,
    queryType: "all" as const,
  }));
  const videoAccessMode = mediaAccessModeField(formData, "videoAccessMode");
  const audioAccessMode = mediaAccessModeField(formData, "audioAccessMode");
  const fileAccessMode = mediaAccessModeField(formData, "fileAccessMode");
  const next: SiteSettings = {
    ...previous,
    siteName: String(formData.get("siteName") || "").trim(),
    siteTitle: String(formData.get("siteTitle") || "").trim(),
    settingsPreviewText: String(formData.get("settingsPreviewText") || "").trim(),
    readerDefaultFontSize: intField(formData, "readerDefaultFontSize", previous.readerDefaultFontSize || 17, 5, 50),
    adminUsername,
    adminPasswordHash: newPassword ? hashPassword(newPassword) : previous.adminPasswordHash,
    adminPasswordSha256: newPassword ? "" : previous.adminPasswordSha256,
    adminAllowedIps: String(formData.get("adminAllowedIps") || "").trim(),
    adminBlockedIps: String(formData.get("adminBlockedIps") || "").trim(),
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
    noticeDisplaySeconds: intField(formData, "noticeDisplaySeconds", previous.noticeDisplaySeconds || getNoticeDisplaySeconds(), 0, 60),
    noticeStayVisibleAfterBlur: formData.get("noticeStayVisibleAfterBlur") === "on",
    contentIndexMaxSegments: intField(formData, "contentIndexMaxSegments", previous.contentIndexMaxSegments || getContentIndexMaxSegments(), 1, 100000),
    globalSearchMaxResults: intField(formData, "globalSearchMaxResults", previous.globalSearchMaxResults || getGlobalSearchMaxResults(), 1, 1000),
    searchRateLimitRules,
    contentRateLimitRules,
    userLoginEnabled: formData.get("userLoginEnabled") === "on",
    userLoginCaptchaMode:
      formData.get("userLoginCaptchaMode") === "image" || formData.get("userLoginCaptchaMode") === "slider"
        ? (formData.get("userLoginCaptchaMode") as SiteSettings["userLoginCaptchaMode"])
        : "off",
    userRegistrationEnabled: formData.get("userRegistrationEnabled") === "on",
    userDailyRegistrationLimitPerIp: intField(
      formData,
      "userDailyRegistrationLimitPerIp",
      previous.userDailyRegistrationLimitPerIp || getUserDailyRegistrationLimitPerIp(),
      0,
      100,
    ),
    userSearchRateLimitPerMinute: intField(
      formData,
      "userSearchRateLimitPerMinute",
      previous.userSearchRateLimitPerMinute || getUserSearchRateLimitPerMinute(),
      1,
      600,
    ),
    userAvatarMaxBytes: Math.floor(userAvatarMaxMb * 1024 ** 2),
    analyticsEnabled: formData.get("analyticsEnabled") === "on",
    analyticsRealtimeLimit: intField(formData, "analyticsRealtimeLimit", previous.analyticsRealtimeLimit || 300, 30, 2000),
    videoLibraryEnabled: videoAccessMode !== "off",
    audioLibraryEnabled: audioAccessMode !== "off",
    fileLibraryEnabled: fileAccessMode !== "off",
    guestLibraryNavEnabled: formData.get("libraryGuestAccess") === "public",
    guestVideoNavEnabled: videoAccessMode === "public",
    guestAudioNavEnabled: audioAccessMode === "public",
    guestFileNavEnabled: fileAccessMode === "public",
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
  try {
    writeSiteSettings(next);
  } catch (error) {
    console.error("Failed to save admin settings", error);
    adminNotice("后台设置保存失败，请检查数据目录权限和磁盘空间", "error", "/admin/settings");
  }
  revalidatePath("/");
  revalidatePath("/login");
  revalidatePath("/register");
  revalidatePath("/account");
  revalidatePath("/media");
  revalidatePath("/search");
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/indexes");
  revalidatePath("/admin/analytics");
  revalidatePath("/admin/users");
  if (adminUsername) {
    await setAdminSession(adminUsername);
  }
  adminNotice("后台设置已保存", "success", "/admin/settings");
}

export async function updateAdminMediaAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const returnPath = mediaReturnPath(formData);
  const id = Number(formData.get("mediaId"));
  const title = String(formData.get("title") || "").trim();
  const artist = String(formData.get("artist") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const asset = Number.isInteger(id) && id > 0 ? getMediaAsset(id) : null;
  if (!asset) {
    adminNotice("资源不存在", "warning", returnPath);
  }
  if (!title || title.length > 120) {
    adminNotice("标题应为 1 到 120 个字符", "warning", returnPath);
  }
  if (description.length > 1000) {
    adminNotice("简介不能超过 1000 个字符", "warning", returnPath);
  }
  if (artist.length > 80) {
    adminNotice("作者不能超过 80 个字符", "warning", returnPath);
  }
  try {
    updateMediaAsset(id, title, asset.kind === "audio" ? artist : "", description, String(formData.get("targetFolder") || ""));
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", returnPath);
  }
  revalidatePath("/media");
  revalidatePath(`/media/${id}`);
  revalidatePath("/admin/media");
  adminNotice("资源信息已更新", "success", returnPath);
}

export async function saveAdminMediaDisplaySettingsAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const returnPath = mediaReturnPath(formData);
  const previous = readSiteSettings();
  const next: SiteSettings = {
    ...previous,
    videoThumbnailMode: formData.get("videoThumbnailMode") === "carousel" ? "carousel" : "single",
    videoThumbnailSinglePercent: intField(formData, "videoThumbnailSinglePercent", previous.videoThumbnailSinglePercent, 1, 99),
    videoThumbnailCarouselFrames: intField(formData, "videoThumbnailCarouselFrames", previous.videoThumbnailCarouselFrames, 2, 8),
    videoThumbnailCarouselIntervalSeconds: intField(
      formData,
      "videoThumbnailCarouselIntervalSeconds",
      previous.videoThumbnailCarouselIntervalSeconds,
      1,
      15,
    ),
    relatedVideoCount: intField(formData, "relatedVideoCount", previous.relatedVideoCount, 0, 20),
    relatedVideoMode: formData.get("relatedVideoMode") === "random" ? "random" : "next",
  };
  try {
    writeSiteSettings(next);
    if (
      previous.videoThumbnailMode !== next.videoThumbnailMode ||
      previous.videoThumbnailSinglePercent !== next.videoThumbnailSinglePercent ||
      previous.videoThumbnailCarouselFrames !== next.videoThumbnailCarouselFrames
    ) {
      clearMediaThumbnails();
    }
  } catch (error) {
    console.error("Failed to save media display settings", error);
    adminNotice("视频展示设置保存失败", "error", returnPath);
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice("视频展示设置已保存", "success", returnPath);
}

export async function deleteAdminMediaAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const returnPath = mediaReturnPath(formData);
  const ids = Array.from(
    new Set(
      formData
        .getAll("mediaIds")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
  if (!ids.length) {
    adminNotice("请选择要删除的资源", "warning", returnPath);
  }
  const result = deleteMediaAssets(ids);
  revalidatePath("/media");
  revalidatePath("/admin");
  revalidatePath("/admin/media");
  if (result.fileDeleteFailures) {
    adminNotice(`已删除 ${result.deleted} 条记录，但有 ${result.fileDeleteFailures} 个文件未能删除`, "warning", returnPath);
  }
  adminNotice(`已删除 ${result.deleted} 个资源`, result.deleted ? "success" : "warning", returnPath);
}

export async function syncAdminMediaAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const returnPath = mediaReturnPath(formData);
  let result: ReturnType<typeof syncMediaLibrary>;
  try {
    result = syncMediaLibrary({ force: true });
  } catch {
    adminNotice("媒体目录同步失败，请检查目录权限和文件状态", "error", returnPath);
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice(`同步完成：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}`, "success", returnPath);
}

export async function createAdminMediaFolderAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const kindValue = formData.get("kind");
  if (!isMediaKind(kindValue)) {
    adminNotice("资源类型无效", "warning", mediaReturnPath(formData));
  }
  let folder: string;
  try {
    folder = createMediaFolder(kindValue, String(formData.get("parentFolder") || ""), String(formData.get("folderName") || ""));
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", mediaReturnPath(formData));
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice("文件夹已创建", "success", `/admin/media?kind=${kindValue}&folder=${encodeURIComponent(folder)}`);
}

export async function renameAdminMediaFolderAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const kindValue = formData.get("kind");
  if (!isMediaKind(kindValue)) {
    adminNotice("资源类型无效", "warning", mediaReturnPath(formData));
  }
  let folder: string;
  try {
    folder = renameMediaFolder(kindValue, String(formData.get("folder") || ""), String(formData.get("folderName") || ""));
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", mediaReturnPath(formData));
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice("文件夹已重命名", "success", `/admin/media?kind=${kindValue}&folder=${encodeURIComponent(folder)}`);
}

export async function deleteAdminMediaFolderAction(formData: FormData) {
  await requireAdminRequest("/admin/media");
  const kindValue = formData.get("kind");
  if (!isMediaKind(kindValue)) {
    adminNotice("资源类型无效", "warning", mediaReturnPath(formData));
  }
  const folder = String(formData.get("folder") || "");
  const parent = folder.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  let deleted: boolean;
  try {
    deleted = deleteMediaFolder(kindValue, folder);
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", mediaReturnPath(formData));
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice(deleted ? "空文件夹已删除" : "文件夹不存在", deleted ? "success" : "warning", `/admin/media?kind=${kindValue}&folder=${encodeURIComponent(parent)}`);
}

export async function deleteIpRateLimitBanAction(formData: FormData) {
  await requireAdminRequest("/admin/settings");
  const requestedValues = [...formData.getAll("rateLimitBanKeys"), ...formData.getAll("rateLimitBanKey")];
  const bans = requestedValues.map(parseIpRateLimitBanKey).filter((ban): ban is IpRateLimitBanKey => ban !== null);
  if (bans.length === 0) {
    adminNotice("请选择要解除的封禁记录", "warning", "/admin/settings");
  }

  const deleted = deleteIpRateLimitBans(bans);
  revalidatePath("/admin/settings");
  adminNotice(deleted ? `已解除 ${deleted} 条封禁记录` : "所选封禁记录已不存在", deleted ? "success" : "warning", "/admin/settings");
}

export async function deleteContentIndexAction(formData: FormData) {
  await requireAdminRequest("/admin/indexes");
  const term = deleteContentIndexTerm(getContentIndexDb(), String(formData.get("term") || ""));
  revalidatePath("/admin/indexes");
  adminNotice(term ? `索引词“${term}”已删除` : "索引关键词不能为空", term ? "success" : "warning", "/admin/indexes");
}

export async function createAdminUserAction(formData: FormData) {
  await requireAdminRequest("/admin/users");
  const username = String(formData.get("username") || "").trim();
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const password = String(formData.get("password") || "");
  const status = formData.get("status") === "disabled" ? "disabled" : "active";
  const searchRateLimitPerMinute = optionalIntField(formData, "searchRateLimitPerMinute", 1, 600);

  const usernameError = validateUsername(username);
  if (usernameError) {
    adminNotice(usernameError, "warning", "/admin/users");
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    adminNotice(displayNameError, "warning", "/admin/users");
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    adminNotice(passwordError, "warning", "/admin/users");
  }

  try {
    createUserRecord({
      username,
      displayName,
      passwordHash: hashUserPassword(password),
      status,
      searchRateLimitPerMinute,
    });
  } catch (error) {
    if (isUsernameConflict(error)) {
      adminNotice("用户名已存在", "warning", "/admin/users");
    }
    console.error("Failed to create admin-managed user", error);
    adminNotice("用户创建失败，请检查数据库状态", "error", "/admin/users");
  }

  revalidatePath("/admin/users");
  adminNotice("用户已创建", "success", "/admin/users");
}

export async function updateAdminUserAction(formData: FormData) {
  await requireAdminRequest("/admin/users");
  const userId = Number(formData.get("userId"));
  const displayName = String(formData.get("displayName") || "").trim();
  const status = formData.get("status") === "disabled" ? "disabled" : "active";
  const newPassword = String(formData.get("newPassword") || "");
  const searchRateLimitPerMinute = optionalIntField(formData, "searchRateLimitPerMinute", 1, 600);

  if (!Number.isInteger(userId) || userId < 1) {
    adminNotice("用户不存在", "warning", "/admin/users");
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    adminNotice(displayNameError, "warning", "/admin/users");
  }
  const passwordError = newPassword ? validatePassword(newPassword) : null;
  if (passwordError) {
    adminNotice(passwordError, "warning", "/admin/users");
  }

  const updated = updateUserRecord({
    id: userId,
    displayName,
    status,
    searchRateLimitPerMinute,
    passwordHash: newPassword ? hashUserPassword(newPassword) : undefined,
  });
  if (!updated) {
    adminNotice("用户不存在", "warning", "/admin/users");
  }
  if (newPassword || status === "disabled") {
    deleteUserSessions(userId);
  }
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  adminNotice("用户已更新", "success", "/admin/users");
}

export async function updateAdminUserStatusAction(formData: FormData) {
  await requireAdminRequest("/admin/users");
  const userId = Number(formData.get("userId"));
  const status = formData.get("status") === "disabled" ? "disabled" : "active";

  if (!Number.isInteger(userId) || userId < 1 || !updateUserStatus(userId, status)) {
    adminNotice("用户不存在", "warning", "/admin/users");
  }
  if (status === "disabled") {
    deleteUserSessions(userId);
  }
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  adminNotice(status === "active" ? "用户已启用" : "用户已停用", "success", "/admin/users");
}

export async function deleteAdminUsersAction(formData: FormData) {
  await requireAdminRequest("/admin/users");
  const ids = formData
    .getAll("userIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!ids.length) {
    adminNotice("请选择要删除的用户", "warning", "/admin/users");
  }

  const deleted = deleteUserIds(ids);
  revalidatePath("/admin/users");
  adminNotice(`已删除 ${deleted} 个用户`, deleted ? "success" : "warning", "/admin/users");
}

export async function deleteAdminUserHistoryAction(formData: FormData) {
  await requireAdminRequest("/admin/users");
  const userId = Number(formData.get("userId"));
  const returnPath = Number.isInteger(userId) && userId > 0 ? `/admin/users/${userId}` : "/admin/users";
  const historyKeys = Array.from(
    new Set(
      formData
        .getAll("historyIds")
        .map(String)
        .filter((value) => /^(novel|media):\d+$/.test(value)),
    ),
  );
  if (!historyKeys.length) {
    adminNotice("请选择要删除的浏览记录", "warning", returnPath);
  }
  const deleted = historyKeys.reduce((count, key) => count + Number(deleteBrowseHistoryItem(userId, key)), 0);
  revalidatePath(returnPath);
  adminNotice(`已删除 ${deleted} 条浏览记录`, deleted ? "success" : "warning", returnPath);
}

export async function clearAdminUserHistoryAction(formData: FormData) {
  await requireAdminRequest("/admin/users");
  const userId = Number(formData.get("userId"));
  const returnPath = Number.isInteger(userId) && userId > 0 ? `/admin/users/${userId}` : "/admin/users";
  if (!Number.isInteger(userId) || userId < 1) {
    adminNotice("用户不存在", "warning", "/admin/users");
  }
  const deleted = clearBrowseHistory(userId);
  revalidatePath(returnPath);
  adminNotice(`已删除 ${deleted} 条浏览记录`, deleted ? "success" : "warning", returnPath);
}
