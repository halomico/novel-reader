"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAdminAccessState, getClientIp, matchesIpRule, normalizeAdminNetworkRules } from "@/lib/admin-access";
import { clearAdminSession, getAdminSession, setAdminSession, verifyAdminCredentials } from "@/lib/admin-auth";
import { recordAdminLogin } from "@/lib/admin-login-records";
import {
  getAdminBookPageSize,
  getAdminLoginRateLimitPerMinute,
  getCatalogPageSize,
  getFrontendSearchConcurrencyLimit,
  getGlobalSearchMaxResults,
  getNoticeDisplaySeconds,
  getSearchResultsPageSize,
  getUserDailyRegistrationLimitPerIp,
  isAdminLoginRateLimitEnabled,
  getUserAvatarMaxBytes,
} from "@/lib/config";
import { cancelContentJobs, countActiveContentJobs } from "@/lib/content-jobs";
import { invalidateContentSearchResultCache } from "@/lib/content-search-cache";
import { deleteContentSearchDatabase } from "@/lib/content-search-db";
import { invalidateNovelContentSearchIndex } from "@/lib/content-search-maintenance";
import {
  normalizeHomePortalOrder,
  type HomePortalAccessMode,
  type HomePortalAccessModes,
} from "@/lib/home-portal";
import {
  createVideoCategory,
  createVideoTag,
  createMediaFolder,
  deleteVideoCategory,
  deleteVideoTag,
  deleteMediaAssets,
  deleteMediaFolder,
  getMediaAsset,
  isMediaKind,
  listMediaAssetsByIds,
  listVideoCategories,
  listVideoTags,
  listVideoTagsForAssets,
  MediaCategoryError,
  MediaFolderError,
  MediaTagError,
  renameMediaFolder,
  setVideoCategoryForAssets,
  setVideoTagsForAssets,
  syncMediaLibrary,
  type MediaAsset,
  type MediaKind,
  type VideoCategory,
  type VideoTag,
  updateVideoCategory,
  updateVideoTag,
  updateMediaAsset,
  updateVideoPublishingSettings,
} from "@/lib/media";
import { mutationResult, type MutationResult } from "@/lib/mutation-result";
import {
  grantUserEntitlement,
  parseEntitlementDefinition,
  revokeUserEntitlement,
  updateUserEntitlement,
} from "@/lib/entitlements";
import { scheduleMissingMediaPreparation } from "@/lib/media-maintenance";
import { clearMediaThumbnails } from "@/lib/media-thumbnail";
import { clearRemoteMediaThumbnails } from "@/lib/media-node-client";
import { isRemoteMediaStorage, listRemoteMediaNodes } from "@/lib/media-storage-config";
import {
  createNovelSource,
  deleteEmptyNovelSource,
  deleteNovelChapterIds,
  deleteNovelIds,
  renameNovelFile,
  updateNovelFile,
  updateNovelSourceSettings,
} from "@/lib/novel-files";
import {
  ALL_NOVEL_LIBRARIES_SLUG,
  getNovelSourceById,
  listNovelSources,
  updateNovelAccessPolicy,
  updateNovelChapterOverrides,
  updateNovelDescription,
} from "@/lib/novel-library";
import { getNovelSourceSearchMode, removeNovelSourceSearchMode, setNovelSourceSearchMode } from "@/lib/novel-search-policy";
import { hashPassword } from "@/lib/password";
import { replacePinnedNovels, togglePinnedNovel } from "@/lib/pinned-novels";
import { checkRateLimit } from "@/lib/rate-limit";
import { setNovelRecommendationPool } from "@/lib/recommendation-pool";
import { validateSearchKeyword } from "@/lib/search";
import { detectSiteIconFormat, MAX_SITE_ICON_BYTES, removeSiteIconFile, writeSiteIconFile } from "@/lib/site-icon";
import { readSiteSettings, type SiteSettings, writeSiteSettings } from "@/lib/site-settings";
import { isColorPalette, normalizeReaderLineHeight, normalizeReaderTagsMode } from "@/lib/ui-preferences";
import {
  createTag,
  deleteTag,
  listHotwordsForNovel,
  listTagsForNovel,
  parseHotwordInput,
  setNovelHotwords,
  setNovelTags,
  updateTag,
} from "@/lib/tags";
import { deleteUserSessions, hashUserPassword } from "@/lib/user-auth";
import { recalculateUserLevels, saveUserLevelDefinition } from "@/lib/user-levels";
import { updateUserGrowth } from "@/lib/user-economy";
import { setNovelRecommendationCount } from "@/lib/recommendations";
import {
  clearBrowseHistory,
  createUserRecord,
  deleteBrowseHistoryItem,
  deleteUserIds,
  getUserById,
  updateUserRecord,
  updateUserStatus,
  type UserProfile,
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "@/lib/users";

function adminNotice(message: string, tone: "success" | "warning" | "error" = "success", path = "/admin/books"): never {
  const separator = path.includes("?") ? "&" : "?";
  redirect(`${path}${separator}notice=${encodeURIComponent(message)}&tone=${tone}`);
}

function listReturnPath(formData: FormData, basePath: "/admin/books" | "/admin/users"): string {
  const requested = String(formData.get("returnPath") || "");
  return requested === basePath || (requested.startsWith(`${basePath}?`) && !/[\r\n#\\]/.test(requested))
    ? requested
    : basePath;
}

function novelEditorReturnPath(formData: FormData, bookId: number): string {
  const requested = String(formData.get("returnPath") || "");
  const bookPath = `/books/${bookId}`;
  const isBookPage = requested === bookPath || requested.startsWith(`${bookPath}?`);
  const isChapterPage = new RegExp(`^${bookPath}/chapters/[1-9]\\d*(?:\\?[^#\\\\\\r\\n]*)?$`).test(requested);
  if (isBookPage || isChapterPage) {
    return /[\r\n#\\]/.test(requested) ? "/admin/books" : requested;
  }
  return listReturnPath(formData, "/admin/books");
}

function chapterManagerReturnPath(formData: FormData, bookId: number): string {
  const requestedPage = Math.max(1, Math.floor(Number(formData.get("page") || 1)));
  return `/admin/books/${bookId}/chapters?page=${requestedPage}`;
}

function mediaReturnPath(formData: FormData): string {
  const requested = String(formData.get("returnPath") || "");
  return requested === "/admin/media" || (requested.startsWith("/admin/media?") && !/[\r\n#]/.test(requested)) ? requested : "/admin/media";
}

function userDetailReturnPath(formData: FormData, userId: number): string {
  const requested = String(formData.get("returnPath") || "");
  const basePath = `/admin/users/${userId}`;
  return requested === basePath || (requested.startsWith(`${basePath}?`) && !/[\r\n#\\]/.test(requested))
    ? requested
    : basePath;
}

function tagManagerReturnPath(formData: FormData, editId?: number | null): string {
  const requested = String(formData.get("returnPath") || "");
  const safe = requested === "/admin/tags" || (requested.startsWith("/admin/tags?") && !/[\r\n#\\]/.test(requested))
    ? requested
    : "/admin/tags";
  const params = new URLSearchParams(safe.split("?", 2)[1] || "");
  params.delete("notice");
  params.delete("tone");
  if (editId === null) params.delete("edit");
  else if (editId) params.set("edit", String(editId));
  return `/admin/tags${params.size ? `?${params.toString()}` : ""}`;
}

function mediaFolderReturnPath(formData: FormData, kind: MediaKind, folder: string): string {
  const current = mediaReturnPath(formData);
  const params = new URLSearchParams(current.split("?", 2)[1] || "");
  params.set("kind", kind);
  if (folder) params.set("folder", folder);
  else params.delete("folder");
  params.delete("page");
  params.delete("notice");
  params.delete("tone");
  return `/admin/media?${params.toString()}`;
}

function mediaFolderMessage(error: unknown): string {
  return error instanceof MediaFolderError ? error.message : "文件夹操作失败，请检查媒体目录权限";
}

function mediaOperationMessage(error: unknown): string {
  return error instanceof MediaFolderError || error instanceof MediaCategoryError || error instanceof MediaTagError
    ? error.message
    : "资源操作失败，请检查媒体目录和数据库状态";
}

function loginNotice(message: string, username = ""): never {
  const params = new URLSearchParams({ error: message });
  if (username) params.set("username", username);
  redirect(`/admin/login?${params.toString()}`);
}

async function requireAdminRequest() {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed) {
    notFound();
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

function homeCardAccessModeField(formData: FormData, name: string): HomePortalAccessMode {
  const value = formData.get(name);
  return value === "member" || value === "browse" || value === "public" ? value : "off";
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

  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  if (isAdminLoginRateLimitEnabled()) {
    const limit = checkRateLimit({
      key: `admin-login:${access.clientIp}`,
      limit: getAdminLoginRateLimitPerMinute(),
      windowMs: 60_000,
    });
    if (!limit.allowed) {
      loginNotice(`登录太频繁，请 ${limit.retryAfterSeconds} 秒后再试`, username);
    }
  }

  if (!verifyAdminCredentials(username, password)) {
    loginNotice("用户名或密码不正确，或后台密钥尚未配置", username);
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
  await requireAdminRequest();
  cancelContentJobs("search");
  adminNotice("已请求停止所有前台全文搜索任务", "success", "/admin/settings");
}

export async function uploadSiteIconAction(formData: FormData) {
  await requireAdminRequest();
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
  await requireAdminRequest();
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
  const returnPath = listReturnPath(formData, "/admin/books");
  await requireAdminRequest();
  const ids = formData
    .getAll("bookIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (ids.length === 0) {
    adminNotice("请选择要删除的小说", "warning", returnPath);
  }

  const result = deleteNovelIds(ids);
  revalidatePath("/");
  revalidatePath("/admin/books");
  if (result.fileDeleteFailures.length) {
    adminNotice(
      `已删除 ${result.deleted} 条记录，但有 ${result.fileDeleteFailures.length} 个原文件未能删除，下次扫描可能重新出现`,
      "warning",
      returnPath,
    );
  }
  adminNotice(`已删除 ${result.deleted} 本小说`, result.deleted ? "success" : "warning", returnPath);
}

export async function createNovelSourceAction(formData: FormData) {
  await requireAdminRequest();
  try {
    createNovelSource({
      folderName: String(formData.get("folderName") || ""),
      name: String(formData.get("name") || ""),
    });
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "小说来源创建失败", "warning", "/admin/books/sources");
  }
  revalidatePath("/admin/books");
  revalidatePath("/admin/books/sources");
  revalidatePath("/novels");
  adminNotice("小说来源已创建", "success", "/admin/books/sources");
}

export async function saveNovelSourceAction(formData: FormData) {
  await requireAdminRequest();
  try {
    const sourceId = Number(formData.get("sourceId") || 0);
    const source = getNovelSourceById(sourceId);
    if (!source) throw new Error("小说来源不存在");
    const nextSearchMode = formData.get("searchMode") === "book" ? "book" : "full";
    if (nextSearchMode === "book" && getNovelSourceSearchMode(source.slug) !== "book" && countActiveContentJobs("index") > 0) {
      throw new Error("索引任务运行期间不能切换为轻量书库");
    }
    updateNovelSourceSettings(sourceId, {
      name: String(formData.get("name") || ""),
      sortOrder: Number(formData.get("sortOrder") || 0),
    });
    setNovelSourceSearchMode(source.slug, nextSearchMode);
    if (nextSearchMode === "book") deleteContentSearchDatabase(source.id);
    invalidateContentSearchResultCache();
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "小说来源保存失败", "warning", "/admin/books/sources");
  }
  revalidatePath("/admin/books");
  revalidatePath("/admin/books/sources");
  revalidatePath("/admin/indexes");
  revalidatePath("/novels");
  revalidatePath("/search");
  adminNotice("来源设置已保存", "success", "/admin/books/sources");
}

export async function deleteNovelSourceAction(formData: FormData) {
  await requireAdminRequest();
  try {
    const sourceId = Number(formData.get("sourceId") || 0);
    const source = getNovelSourceById(sourceId);
    deleteEmptyNovelSource(sourceId);
    if (source) {
      removeNovelSourceSearchMode(source.slug);
      deleteContentSearchDatabase(source.id);
    }
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "小说来源删除失败", "warning", "/admin/books/sources");
  }
  revalidatePath("/admin/books");
  revalidatePath("/admin/books/sources");
  revalidatePath("/novels");
  adminNotice("空来源已删除", "success", "/admin/books/sources");
}

export async function togglePinnedNovelAction(formData: FormData) {
  await requireAdminRequest();
  const novelId = Number(formData.get("bookId"));
  if (!Number.isInteger(novelId) || novelId < 1) {
    return;
  }
  togglePinnedNovel(novelId);
  revalidatePath("/");
  revalidatePath(`/books/${novelId}`);
  revalidatePath("/admin/books");
}

export async function savePinnedNovelsAction(formData: FormData): Promise<MutationResult> {
  await requireAdminRequest();
  const novelIds = formData
    .getAll("bookIds")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  try {
    replacePinnedNovels(novelIds);
  } catch (error) {
    return mutationResult(false, error instanceof Error ? error.message : "置顶列表保存失败", "warning");
  }
  revalidatePath("/");
  for (const novelId of novelIds) revalidatePath(`/books/${novelId}`);
  return mutationResult(true, "置顶列表已保存", "success");
}

function tagOperationMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
    return "标签名称或链接标识已存在";
  }
  return error instanceof Error ? error.message : "标签操作失败，请检查数据库状态";
}

export async function saveAdminTagAction(formData: FormData) {
  const tagId = Number(formData.get("tagId") || 0);
  const visibilityValue = formData.get("visibility");
  const visibility = visibilityValue === "member" || visibilityValue === "hidden" ? visibilityValue : "public";
  let returnPath = tagManagerReturnPath(formData, Number.isInteger(tagId) && tagId > 0 ? tagId : undefined);
  await requireAdminRequest();
  try {
    if (Number.isInteger(tagId) && tagId > 0) {
      const updated = updateTag({
        id: tagId,
        parentId: String(formData.get("parentId") || ""),
        name: String(formData.get("name") || ""),
        slug: String(formData.get("slug") || ""),
        description: String(formData.get("description") || ""),
        aliases: String(formData.get("aliases") || ""),
        sortOrder: String(formData.get("sortOrder") || "0"),
        visibility,
      });
      if (!updated) {
        adminNotice("标签不存在", "warning", returnPath);
      }
    } else {
      const created = createTag({
        parentId: String(formData.get("parentId") || ""),
        name: String(formData.get("name") || ""),
        slug: String(formData.get("slug") || ""),
        description: String(formData.get("description") || ""),
        aliases: String(formData.get("aliases") || ""),
        sortOrder: String(formData.get("sortOrder") || "0"),
        visibility,
      });
      returnPath = tagManagerReturnPath(formData, created.id);
    }
  } catch (error) {
    adminNotice(tagOperationMessage(error), "warning", returnPath);
  }
  revalidatePath("/", "layout");
  revalidatePath("/tags");
  revalidatePath("/admin/tags");
  adminNotice(tagId ? "标签已更新" : "标签已创建", "success", returnPath);
}

export async function deleteAdminTagAction(formData: FormData) {
  const tagId = Number(formData.get("tagId") || 0);
  const returnPath = tagManagerReturnPath(formData, null);
  await requireAdminRequest();
  if (!Number.isInteger(tagId) || tagId < 1) {
    adminNotice("标签不存在", "warning", returnPath);
  }
  const deleted = deleteTag(tagId);
  revalidatePath("/", "layout");
  revalidatePath("/tags");
  revalidatePath("/admin/tags");
  adminNotice(deleted ? "标签已删除" : "标签不存在", deleted ? "success" : "warning", returnPath);
}

export async function saveNovelTaggingAction(formData: FormData) {
  const bookId = Number(formData.get("bookId") || 0);
  const returnPath = Number.isInteger(bookId) && bookId > 0 ? `/admin/books/${bookId}/tags` : "/admin/books";
  await requireAdminRequest();
  if (!Number.isInteger(bookId) || bookId < 1) {
    adminNotice("小说不存在", "warning", "/admin/books");
  }
  const tagIds = formData
    .getAll("tagIds")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  let hotwords: string[];
  try {
    hotwords = parseHotwordInput(String(formData.get("hotwords") || ""));
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "热词格式无效", "warning", returnPath);
  }
  for (const term of hotwords) {
    const validation = validateSearchKeyword(term);
    if (!validation.ok) {
      adminNotice(`热词“${term}”：${validation.message}`, "warning", returnPath);
    }
  }
  setNovelTags(bookId, tagIds);
  setNovelHotwords(bookId, hotwords);
  revalidatePath(`/books/${bookId}`);
  revalidatePath("/tags");
  revalidatePath("/admin/books");
  revalidatePath(returnPath);
  adminNotice("标签和热词已保存", "success", returnPath);
}

export async function saveNovelEditorAction(formData: FormData) {
  const bookId = Number(formData.get("bookId") || 0);
  const successPath = Number.isInteger(bookId) && bookId > 0 ? novelEditorReturnPath(formData, bookId) : "/admin/books";
  const editorParams = new URLSearchParams();
  if (successPath !== "/admin/books") {
    editorParams.set("returnPath", successPath);
  }
  const editorPath = Number.isInteger(bookId) && bookId > 0
    ? `/admin/books/${bookId}/edit${editorParams.size ? `?${editorParams.toString()}` : ""}`
    : "/admin/books";
  await requireAdminRequest();
  if (!Number.isInteger(bookId) || bookId < 1) {
    adminNotice("小说不存在", "warning", "/admin/books");
  }

  const tagIds = formData
    .getAll("tagIds")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  let hotwords: string[];
  try {
    hotwords = parseHotwordInput(String(formData.get("hotwords") || ""));
    for (const term of hotwords) {
      const validation = validateSearchKeyword(term);
      if (!validation.ok) {
        adminNotice(`热词“${term}”：${validation.message}`, "warning", editorPath);
      }
    }
    if (formData.has("content")) {
      updateNovelFile(bookId, String(formData.get("title") || ""), String(formData.get("content") || ""));
    } else {
      renameNovelFile(bookId, String(formData.get("title") || ""));
    }
    updateNovelDescription(bookId, String(formData.get("description") || ""));
    setNovelTags(bookId, tagIds);
    setNovelHotwords(bookId, hotwords);
    setNovelRecommendationPool(
      bookId,
      formData.get("recommendationPool") === "on",
    );
    setNovelRecommendationCount(
      bookId,
      intField(formData, "recommendationCount", 0, 0, 2_000_000_000),
    );
    const accessMode = formData.get("accessMode") === "soda" ? "soda" : "inherit";
    updateNovelAccessPolicy(bookId, {
      accessMode,
      sodaPrice: intField(formData, "sodaPrice", 1, 0, 1_000_000),
      previewChapterCount: intField(formData, "previewChapterCount", 0, 0, 100_000),
    });
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "小说保存失败，请检查小说目录权限", "warning", editorPath);
  }

  revalidatePath("/");
  revalidatePath("/novels");
  revalidatePath("/search");
  revalidatePath(`/books/${bookId}`);
  revalidatePath(`/books/${bookId}/chapters`);
  revalidatePath("/tags");
  revalidatePath("/admin/books");
  revalidatePath(successPath);
  adminNotice("小说已保存", "success", successPath);
}

export async function saveNovelChaptersAction(formData: FormData) {
  await requireAdminRequest();
  const bookId = Number(formData.get("bookId") || 0);
  if (!Number.isInteger(bookId) || bookId < 1) adminNotice("小说不存在", "warning", "/admin/books");
  const returnPath = chapterManagerReturnPath(formData, bookId);
  const intent = formData.get("intent") === "delete" ? "delete" : "save";

  try {
    if (intent === "delete") {
      const chapterIds = formData.getAll("selectedChapterIds").map(Number);
      const deleted = deleteNovelChapterIds(bookId, chapterIds);
      if (!deleted) adminNotice("请选择要删除的章节", "warning", returnPath);
      revalidatePath(`/books/${bookId}`);
      revalidatePath(`/books/${bookId}/chapters`);
      revalidatePath(returnPath);
      adminNotice(`已删除 ${deleted} 个章节`, "success", returnPath);
    }

    const chapterIds = formData.getAll("chapterRowIds").map(Number).filter((id) => Number.isInteger(id) && id > 0).slice(0, 200);
    const updates = chapterIds.map((id) => ({
      id,
      title: String(formData.get(`chapterTitle:${id}`) || ""),
      sortOrder: Math.max(0, Math.floor(Number(formData.get(`chapterSort:${id}`) || 1)) - 1),
    }));
    const saved = updateNovelChapterOverrides(bookId, updates);
    if (!saved) adminNotice("当前页没有可保存的章节", "warning", returnPath);
    invalidateNovelContentSearchIndex(bookId);
    invalidateContentSearchResultCache();
    revalidatePath(`/books/${bookId}`);
    revalidatePath(`/books/${bookId}/chapters`);
    revalidatePath(returnPath);
    adminNotice("章节已保存", "success", returnPath);
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "章节操作失败", "warning", returnPath);
  }
}

export async function batchUpdateNovelsAction(formData: FormData) {
  const ids = Array.from(new Set(
    formData
      .getAll("bookIds")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )).slice(0, 100);
  const successPath = listReturnPath(formData, "/admin/books");
  const editorParams = new URLSearchParams({ ids: ids.join(",") });
  if (successPath !== "/admin/books") {
    editorParams.set("returnPath", successPath);
  }
  const editorPath = ids.length ? `/admin/books/batch?${editorParams.toString()}` : "/admin/books";
  await requireAdminRequest();
  if (!ids.length) {
    adminNotice("请选择要编辑的小说", "warning", "/admin/books");
  }

  const addedTagIds = Array.from(new Set(
    formData
      .getAll("tagIds")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  ));
  let addedHotwords: string[];
  try {
    addedHotwords = parseHotwordInput(String(formData.get("hotwords") || ""));
    for (const term of addedHotwords) {
      const validation = validateSearchKeyword(term);
      if (!validation.ok) {
        adminNotice(`热词“${term}”：${validation.message}`, "warning", editorPath);
      }
    }

    for (const id of ids) {
      renameNovelFile(id, String(formData.get(`title-${id}`) || ""));
      if (addedTagIds.length) {
        const currentTagIds = listTagsForNovel(id, { includeHidden: true }).map((tag) => tag.id);
        setNovelTags(id, [...currentTagIds, ...addedTagIds]);
      }
      if (addedHotwords.length) {
        setNovelHotwords(id, [...listHotwordsForNovel(id), ...addedHotwords]);
      }
      revalidatePath(`/books/${id}`);
    }
  } catch (error) {
    adminNotice(error instanceof Error ? error.message : "批量编辑失败，请检查小说目录权限", "warning", editorPath);
  }

  revalidatePath("/");
  revalidatePath("/search");
  revalidatePath("/tags");
  revalidatePath("/admin/books");
  adminNotice(`已更新 ${ids.length} 本小说`, "success", successPath);
}

export async function saveAdminSettingsAction(formData: FormData) {
  await requireAdminRequest();
  const headerStore = await headers();
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

  const userAvatarMaxMb = numberField(formData, "userAvatarMaxMb", getUserAvatarMaxBytes() / 1024 ** 2, 0.1, 10);
  const novelAccessMode = homeCardAccessModeField(formData, "novelAccessMode");
  const videoAccessMode = homeCardAccessModeField(formData, "videoAccessMode");
  const audioAccessMode = homeCardAccessModeField(formData, "audioAccessMode");
  const fileAccessMode = homeCardAccessModeField(formData, "fileAccessMode");
  const tagAccessMode = homeCardAccessModeField(formData, "tagAccessMode");
  const announcementCardAccessMode = homeCardAccessModeField(formData, "announcementCardAccessMode");
  const advancedTagAccessMode = mediaAccessModeField(formData, "advancedTagAccessMode");
  const hotwordAccessMode = mediaAccessModeField(formData, "hotwordAccessMode");
  const homeCardModes: HomePortalAccessModes = {
    announcement: announcementCardAccessMode,
    novels: novelAccessMode,
    tags: tagAccessMode,
    video: videoAccessMode,
    audio: audioAccessMode,
    file: fileAccessMode,
  };
  const defaultPalette = String(formData.get("defaultPalette") || "default");
  const defaultNovelLibrarySlug = String(formData.get("defaultNovelLibrarySlug") || "default")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .slice(0, 64);
  const availableNovelLibrarySlugs = new Set([
    ALL_NOVEL_LIBRARIES_SLUG,
    ...listNovelSources({ includeEmpty: true }).map((source) => source.slug),
  ]);
  if (!availableNovelLibrarySlugs.has(defaultNovelLibrarySlug)) {
    adminNotice("默认进入书库不存在，请重新选择", "warning", "/admin/settings");
  }
  const adminAllowedNetworks = normalizeAdminNetworkRules(formData.get("adminAllowedNetworks"));
  const adminIpAllowlistEnabled = formData.get("adminIpAllowlistEnabled") === "on";
  const currentAdminIp = getClientIp(headerStore);
  if (adminIpAllowlistEnabled && adminAllowedNetworks.length === 0) {
    adminNotice("启用后台白名单前，请至少填写一个 IP 或 CIDR", "warning", "/admin/settings");
  }
  if (adminIpAllowlistEnabled && !adminAllowedNetworks.some((rule) => matchesIpRule(currentAdminIp, rule))) {
    adminNotice(`当前后台 IP ${currentAdminIp} 不在白名单中，未保存以避免锁定后台`, "warning", "/admin/settings");
  }
  const next: SiteSettings = {
    ...previous,
    siteName: String(formData.get("siteName") || "").trim(),
    siteTitle: String(formData.get("siteTitle") || "").trim(),
    brandLinkTarget: formData.get("brandLinkTarget") === "home" ? "home" : "novels",
    settingsPreviewText: String(formData.get("settingsPreviewText") || "").trim(),
    defaultNovelLibrarySlug,
    readerDefaultFontSize: intField(formData, "readerDefaultFontSize", previous.readerDefaultFontSize || 18, 8, 25),
    readerDefaultLineHeight: normalizeReaderLineHeight(
      String(formData.get("readerDefaultLineHeight") || ""),
      normalizeReaderLineHeight(previous.readerDefaultLineHeight),
    ),
    readerDefaultTagsMode: normalizeReaderTagsMode(
      String(formData.get("readerDefaultTagsMode") || ""),
      previous.readerDefaultTagsMode,
    ),
    readerAdjacentNovelSort: formData.get("readerAdjacentNovelSort") === "name" ? "name" : "updated",
    novelCatalogSearchExpanded: formData.get("novelCatalogSearchExpanded") === "on",
    defaultPalette: isColorPalette(defaultPalette) ? defaultPalette : "default",
    defaultPaletteRandomEnabled: formData.get("defaultPaletteRandomEnabled") === "on",
    defaultPaletteRotationMinutes: intField(
      formData,
      "defaultPaletteRotationMinutes",
      previous.defaultPaletteRotationMinutes || 1_440,
      1,
      10_080,
    ),
    adminUsername,
    adminPasswordHash: newPassword ? hashPassword(newPassword) : previous.adminPasswordHash,
    adminPasswordSha256: newPassword ? "" : previous.adminPasswordSha256,
    adminLoginRateLimitPerMinute: intField(formData, "adminLoginRateLimitPerMinute", previous.adminLoginRateLimitPerMinute || 6, 1, 120),
    adminLoginRateLimitEnabled: formData.get("adminLoginRateLimitEnabled") === "on",
    adminIpAllowlistEnabled,
    adminAllowedNetworks,
    catalogPageSize: intField(formData, "catalogPageSize", previous.catalogPageSize || getCatalogPageSize(), 1, 100),
    searchResultsPageSize: intField(formData, "searchResultsPageSize", previous.searchResultsPageSize || getSearchResultsPageSize(), 1, 100),
    adminBookPageSize: intField(formData, "adminBookPageSize", previous.adminBookPageSize || getAdminBookPageSize(), 1, 200),
    randomCatalogEnabled: formData.get("randomCatalogEnabled") === "on",
    manualPinnedNovelsEnabled: formData.get("manualPinnedNovelsEnabled") === "on",
    randomRecommendationsEnabled: formData.get("randomRecommendationsEnabled") === "on",
    catalogPromotionOrder: formData.get("catalogPromotionOrder") === "random-first" ? "random-first" : "manual-first",
    randomRecommendationCount: intField(
      formData,
      "randomRecommendationCount",
      previous.randomRecommendationCount || 8,
      1,
      1000,
    ),
    randomRecommendationIntervalMinutes: intField(
      formData,
      "randomRecommendationIntervalMinutes",
      previous.randomRecommendationIntervalMinutes || 360,
      1,
      10_080,
    ),
    noticeDisplaySeconds: intField(formData, "noticeDisplaySeconds", previous.noticeDisplaySeconds || getNoticeDisplaySeconds(), 0, 60),
    audioDefaultPlaybackMode:
      formData.get("audioDefaultPlaybackMode") === "stop" || formData.get("audioDefaultPlaybackMode") === "repeat-one"
        ? formData.get("audioDefaultPlaybackMode") as "stop" | "repeat-one"
        : "next",
    globalSearchMaxResults: intField(formData, "globalSearchMaxResults", previous.globalSearchMaxResults || getGlobalSearchMaxResults(), 1, 1000),
    userLoginEnabled: formData.get("userLoginEnabled") === "on",
    userRegistrationEnabled: formData.get("userRegistrationMode") !== "closed",
    userRegistrationMode:
      formData.get("userRegistrationMode") === "invite" || formData.get("userRegistrationMode") === "closed"
        ? formData.get("userRegistrationMode") as "invite" | "closed"
        : "open",
    emailVerificationRequired: formData.get("emailVerificationRequired") === "on",
    marketEnabled: formData.get("marketEnabled") === "on",
    cookieToSodaRate: intField(
      formData,
      "cookieToSodaRate",
      previous.cookieToSodaRate || 10,
      1,
      10_000,
    ),
    bidirectionalCurrencyExchangeEnabled: formData.get("bidirectionalCurrencyExchangeEnabled") === "on",
    userDailyRegistrationLimitPerIp: intField(
      formData,
      "userDailyRegistrationLimitPerIp",
      previous.userDailyRegistrationLimitPerIp || getUserDailyRegistrationLimitPerIp(),
      0,
      100,
    ),
    userDailyReportLimit: intField(formData, "userDailyReportLimit", previous.userDailyReportLimit || 50, 1, 500),
    userAvatarMaxBytes: Math.floor(userAvatarMaxMb * 1024 ** 2),
    stationDisplayName: String(formData.get("stationDisplayName") || "站务")
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 20) || "站务",
    announcementCardTarget: formData.get("announcementCardTarget") === "latest" ? "latest" : "list",
    homePortalOrder: normalizeHomePortalOrder(formData.get("homePortalOrder")),
    homePortalAccessModes: homeCardModes,
    analyticsEnabled: formData.get("analyticsEnabled") === "on",
    analyticsRealtimeLimit: intField(formData, "analyticsRealtimeLimit", previous.analyticsRealtimeLimit || 300, 30, 10_000),
    advancedTagSearchEnabled: advancedTagAccessMode !== "off",
    hotwordLinksEnabled: hotwordAccessMode !== "off",
    guestAdvancedTagSearchEnabled: advancedTagAccessMode === "public",
    guestHotwordLinksEnabled: hotwordAccessMode === "public",
    frontendSearchConcurrencyLimit: intField(
      formData,
      "frontendSearchConcurrencyLimit",
      previous.frontendSearchConcurrencyLimit || getFrontendSearchConcurrencyLimit(),
      1,
      100,
    ),
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
  revalidatePath("/novels");
  revalidatePath("/media");
  revalidatePath("/tags");
  revalidatePath("/tags/search");
  revalidatePath("/search");
  revalidatePath("/settings");
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  revalidatePath("/admin/settings");
  revalidatePath("/admin/indexes");
  revalidatePath("/admin/analytics");
  revalidatePath("/admin/users");
  revalidatePath("/sitemap.xml");
  if (adminUsername) {
    await setAdminSession(adminUsername);
  }
  adminNotice("后台设置已保存", "success", "/admin/settings");
}

export async function loadAdminMediaSelectionAction(requestedIds: number[]) {
  await requireAdminRequest();
  const ids = Array.from(new Set(
    requestedIds.filter((id) => Number.isInteger(id) && id > 0),
  )).slice(0, 100);
  return listMediaAssetsByIds(ids);
}

export async function updateAdminMediaAction(
  formData: FormData,
): Promise<MutationResult<{ asset: MediaAsset; tags: VideoTag[] }>> {
  await requireAdminRequest();
  const id = Number(formData.get("mediaId"));
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const asset = Number.isInteger(id) && id > 0 ? getMediaAsset(id) : null;
  if (!asset) {
    return mutationResult(false, "资源不存在", "warning");
  }
  const artist = asset.kind === "file" ? "" : String(formData.get("artist") || "").trim();
  if (!title || title.length > 120) {
    return mutationResult(false, "标题应为 1 到 120 个字符", "warning");
  }
  if (description.length > 1000) {
    return mutationResult(false, "简介不能超过 1000 个字符", "warning");
  }
  if (artist.length > 80) {
    return mutationResult(false, "作者不能超过 80 个字符", "warning");
  }
  try {
    const updated = await updateMediaAsset(
      id,
      title,
      artist,
      description,
      String(formData.get("targetFolder") || ""),
      asset.kind === "video" && formData.has("categoryId") ? formData.get("categoryId") : undefined,
    );
    if (!updated) {
      return mutationResult(false, "资源不存在", "warning");
    }
    if (asset.kind === "video") {
      setVideoTagsForAssets([id], formData.getAll("tagIds").map(Number));
      const latestAction = String(formData.get("latestAction") || "keep");
      const newDays = Math.min(Math.max(Math.floor(Number(formData.get("newDays")) || 14), 1), 365);
      updateVideoPublishingSettings({
        id,
        playSodaPrice: Number(formData.get("playSodaPrice") || 0),
        downloadSodaPrice: Number(formData.get("downloadSodaPrice") || 0),
        publishedAt: latestAction === "mark" ? new Date().toISOString() : asset.publishedAt,
        newUntil: latestAction === "mark"
          ? new Date(Date.now() + newDays * 86_400_000).toISOString()
          : latestAction === "clear" ? null : asset.newUntil,
      });
    }
    const nextAsset = getMediaAsset(id);
    if (!nextAsset) {
      return mutationResult(false, "资源不存在", "warning");
    }
    revalidatePath("/media");
    revalidatePath("/media/tags");
    revalidatePath(`/media/${id}`);
    return mutationResult(true, "资源信息已更新", "success", {
      asset: nextAsset,
      tags: listVideoTagsForAssets([id])[id] || [],
    });
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
}

export async function batchUpdateAdminMediaAction(
  formData: FormData,
): Promise<MutationResult<{ assets: MediaAsset[]; tagsByAsset: Record<number, VideoTag[]> }>> {
  await requireAdminRequest();
  const ids = Array.from(new Set(
    formData
      .getAll("mediaIds")
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0),
  )).slice(0, 100);
  if (!ids.length) {
    return mutationResult(false, "请选择要编辑的资源", "warning");
  }

  const applyArtist = formData.get("applyArtist") === "on";
  const applyDescription = formData.get("applyDescription") === "on";
  const applyTags = formData.get("applyTags") === "on";
  const applyVideoPrice = formData.get("applyVideoPrice") === "on";
  const applyVideoDownloadPrice = formData.get("applyVideoDownloadPrice") === "on";
  const latestAction = String(formData.get("latestAction") || "keep");
  const newDays = Math.min(Math.max(Math.floor(Number(formData.get("newDays")) || 14), 1), 365);
  const artist = String(formData.get("artist") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const targetFolder = String(formData.get("targetFolder") || "__keep__");
  const categoryId = String(formData.get("categoryId") || "__keep__");
  const tagIds = formData.getAll("tagIds").map(Number);
  if (artist.length > 80 || description.length > 1000) {
    return mutationResult(
      false,
      artist.length > 80 ? "作者不能超过 80 个字符" : "简介不能超过 1000 个字符",
      "warning",
    );
  }

  let updated = 0;
  try {
    for (const id of ids) {
      const asset = getMediaAsset(id);
      if (!asset) continue;
      const title = String(formData.get(`title-${id}`) || "").trim();
      await updateMediaAsset(
        id,
        title,
        asset.kind !== "file" && applyArtist ? artist : asset.kind !== "file" ? asset.artist : "",
        applyDescription ? description : asset.description,
        targetFolder === "__keep__" ? undefined : targetFolder,
        asset.kind === "video" && categoryId !== "__keep__" ? categoryId : undefined,
      );
      if (asset.kind === "video" && applyTags) setVideoTagsForAssets([id], tagIds);
      if (asset.kind === "video" && (applyVideoPrice || applyVideoDownloadPrice || latestAction !== "keep")) {
        updateVideoPublishingSettings({
          id,
          playSodaPrice: applyVideoPrice ? Number(formData.get("playSodaPrice") || 0) : asset.playSodaPrice,
          downloadSodaPrice: applyVideoDownloadPrice
            ? Number(formData.get("downloadSodaPrice") || 0)
            : asset.downloadSodaPrice,
          publishedAt: latestAction === "mark" ? new Date().toISOString() : asset.publishedAt,
          newUntil: latestAction === "mark"
            ? new Date(Date.now() + newDays * 86_400_000).toISOString()
            : latestAction === "clear" ? null : asset.newUntil,
        });
      }
      updated += 1;
      revalidatePath(`/media/${id}`);
    }
  } catch (error) {
    return mutationResult(
      false,
      mediaOperationMessage(error),
      "warning",
      { assets: listMediaAssetsByIds(ids), tagsByAsset: listVideoTagsForAssets(ids) },
    );
  }
  revalidatePath("/media");
  revalidatePath("/media/tags");
  revalidatePath("/sitemap/media.xml");
  return mutationResult(
    updated > 0,
    `已更新 ${updated} 个资源`,
    updated ? "success" : "warning",
    { assets: listMediaAssetsByIds(ids), tagsByAsset: listVideoTagsForAssets(ids) },
  );
}

export async function createAdminVideoCategoryAction(
  formData: FormData,
): Promise<MutationResult<{ categories: VideoCategory[] }>> {
  await requireAdminRequest();
  try {
    createVideoCategory(String(formData.get("name") || ""));
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
  revalidatePath("/media");
  return mutationResult(true, "视频分类已创建", "success", {
    categories: listVideoCategories({ includeHidden: true }),
  });
}

export async function updateAdminVideoCategoryAction(
  formData: FormData,
): Promise<MutationResult<{ categories: VideoCategory[] }>> {
  await requireAdminRequest();
  const id = Number(formData.get("categoryId"));
  let updated = false;
  try {
    updated = updateVideoCategory(
      id,
      String(formData.get("name") || ""),
      Number(formData.get("sortOrder") || 0),
      formData.get("visible") === "on",
    );
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
  if (!updated) {
    return mutationResult(false, "视频分类不存在", "warning");
  }
  revalidatePath("/media");
  return mutationResult(true, "视频分类已更新", "success", {
    categories: listVideoCategories({ includeHidden: true }),
  });
}

export async function deleteAdminVideoCategoryAction(
  formData: FormData,
): Promise<MutationResult<{ categories: VideoCategory[] }>> {
  await requireAdminRequest();
  const deleted = deleteVideoCategory(Number(formData.get("categoryId")));
  revalidatePath("/media");
  return mutationResult(
    deleted,
    deleted ? "视频分类已删除，原视频已归入未分类" : "视频分类不存在",
    deleted ? "success" : "warning",
    { categories: listVideoCategories({ includeHidden: true }) },
  );
}

export async function assignAdminVideoCategoryAction(
  formData: FormData,
): Promise<MutationResult<{ assets: MediaAsset[] }>> {
  await requireAdminRequest();
  const ids = formData
    .getAll("mediaIds")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) {
    return mutationResult(false, "请选择要归类的视频", "warning");
  }
  let updated = 0;
  try {
    updated = setVideoCategoryForAssets(ids, formData.get("categoryId"));
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
  revalidatePath("/media");
  return mutationResult(
    updated > 0,
    updated ? `已归类 ${updated} 个视频` : "所选视频不存在",
    updated ? "success" : "warning",
    { assets: listMediaAssetsByIds(ids) },
  );
}

export async function createAdminVideoTagAction(
  formData: FormData,
): Promise<MutationResult<{ tags: VideoTag[] }>> {
  await requireAdminRequest();
  try {
    createVideoTag(formData.get("name"), formData.get("description"));
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
  revalidatePath("/media");
  revalidatePath("/media/tags");
  revalidatePath("/sitemap/media.xml");
  return mutationResult(true, "视频标签已创建", "success", {
    tags: listVideoTags({ includeHidden: true, pageSize: 5_000 }).tags,
  });
}

export async function updateAdminVideoTagAction(
  formData: FormData,
): Promise<MutationResult<{ tags: VideoTag[] }>> {
  await requireAdminRequest();
  let updated = false;
  try {
    updated = updateVideoTag(
      Number(formData.get("tagId")),
      formData.get("name"),
      formData.get("description"),
      Number(formData.get("sortOrder") || 0),
      formData.get("visible") === "on",
    );
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
  if (!updated) return mutationResult(false, "视频标签不存在", "warning");
  revalidatePath("/media");
  revalidatePath("/media/tags");
  revalidatePath("/sitemap/media.xml");
  return mutationResult(true, "视频标签已更新", "success", {
    tags: listVideoTags({ includeHidden: true, pageSize: 5_000 }).tags,
  });
}

export async function deleteAdminVideoTagAction(
  formData: FormData,
): Promise<MutationResult<{ tags: VideoTag[] }>> {
  await requireAdminRequest();
  const deleted = deleteVideoTag(Number(formData.get("tagId")));
  revalidatePath("/media");
  revalidatePath("/media/tags");
  revalidatePath("/sitemap/media.xml");
  return mutationResult(
    deleted,
    deleted ? "视频标签已删除" : "视频标签不存在",
    deleted ? "success" : "warning",
    { tags: listVideoTags({ includeHidden: true, pageSize: 5_000 }).tags },
  );
}

export async function assignAdminVideoTagsAction(
  formData: FormData,
): Promise<MutationResult<{ tagsByAsset: Record<number, VideoTag[]> }>> {
  await requireAdminRequest();
  const ids = Array.from(new Set(formData.getAll("mediaIds").map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) return mutationResult(false, "请选择视频", "warning");
  let updated = 0;
  try {
    updated = setVideoTagsForAssets(ids, formData.getAll("tagIds").map(Number));
  } catch (error) {
    return mutationResult(false, mediaOperationMessage(error), "warning");
  }
  revalidatePath("/media");
  revalidatePath("/media/tags");
  revalidatePath("/sitemap/media.xml");
  return mutationResult(
    updated > 0,
    updated ? `已更新 ${updated} 个视频的标签` : "所选视频不存在",
    updated ? "success" : "warning",
    { tagsByAsset: listVideoTagsForAssets(ids) },
  );
}

export async function saveAdminMediaDisplaySettingsAction(formData: FormData) {
  await requireAdminRequest();
  const returnPath = mediaReturnPath(formData);
  const previous = readSiteSettings();
  const next: SiteSettings = {
    ...previous,
    videoThumbnailSinglePercent: intField(formData, "videoThumbnailSinglePercent", previous.videoThumbnailSinglePercent, 1, 99),
    relatedVideoCount: intField(formData, "relatedVideoCount", previous.relatedVideoCount, 0, 20),
    relatedVideoMode: formData.get("relatedVideoMode") === "random" ? "random" : "next",
  };
  try {
    writeSiteSettings(next);
    if (previous.videoThumbnailSinglePercent !== next.videoThumbnailSinglePercent) {
      if (isRemoteMediaStorage()) {
        await Promise.all(
          listRemoteMediaNodes().map((node) => clearRemoteMediaThumbnails(node.id)),
        ).catch((error) => {
          console.warn("Failed to clear remote media thumbnails", error);
        });
      } else {
        clearMediaThumbnails();
      }
      scheduleMissingMediaPreparation();
    }
  } catch (error) {
    console.error("Failed to save media display settings", error);
    adminNotice("视频展示设置保存失败", "error", returnPath);
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice("视频展示设置已保存", "success", returnPath);
}

export async function deleteAdminMediaAction(
  formData: FormData,
): Promise<MutationResult<{ deletedIds: number[] }>> {
  await requireAdminRequest();
  const ids = Array.from(
    new Set(
      formData
        .getAll("mediaIds")
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
  if (!ids.length) {
    return mutationResult(false, "请选择要删除的资源", "warning");
  }
  const result = await deleteMediaAssets(ids);
  const remainingIds = new Set(listMediaAssetsByIds(ids).map((asset) => asset.id));
  const deletedIds = ids.filter((id) => !remainingIds.has(id));
  revalidatePath("/media");
  revalidatePath("/admin");
  if (result.fileDeleteFailures) {
    return mutationResult(
      result.deleted > 0,
      `已删除 ${result.deleted} 条记录，但有 ${result.fileDeleteFailures} 个文件未能删除`,
      "warning",
      { deletedIds },
    );
  }
  return mutationResult(
    result.deleted > 0,
    `已删除 ${result.deleted} 个资源`,
    result.deleted ? "success" : "warning",
    { deletedIds },
  );
}

export async function syncAdminMediaAction(formData: FormData) {
  await requireAdminRequest();
  const returnPath = mediaReturnPath(formData);
  let result: Awaited<ReturnType<typeof syncMediaLibrary>>;
  try {
    result = await syncMediaLibrary({ force: true });
    scheduleMissingMediaPreparation();
  } catch {
    adminNotice("媒体同步失败，请检查存储目录或媒体节点状态", "error", returnPath);
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice(`同步完成：新增 ${result.added}，更新 ${result.updated}，移除 ${result.removed}`, "success", returnPath);
}

export async function createAdminMediaFolderAction(formData: FormData) {
  await requireAdminRequest();
  const kindValue = formData.get("kind");
  if (!isMediaKind(kindValue)) {
    adminNotice("资源类型无效", "warning", mediaReturnPath(formData));
  }
  let folder: string;
  try {
    folder = await createMediaFolder(kindValue, String(formData.get("parentFolder") || ""), String(formData.get("folderName") || ""));
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", mediaReturnPath(formData));
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice("文件夹已创建", "success", mediaFolderReturnPath(formData, kindValue, folder));
}

export async function renameAdminMediaFolderAction(formData: FormData) {
  await requireAdminRequest();
  const kindValue = formData.get("kind");
  if (!isMediaKind(kindValue)) {
    adminNotice("资源类型无效", "warning", mediaReturnPath(formData));
  }
  let folder: string;
  try {
    folder = await renameMediaFolder(kindValue, String(formData.get("folder") || ""), String(formData.get("folderName") || ""));
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", mediaReturnPath(formData));
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice("文件夹已重命名", "success", mediaFolderReturnPath(formData, kindValue, folder));
}

export async function deleteAdminMediaFolderAction(formData: FormData) {
  await requireAdminRequest();
  const kindValue = formData.get("kind");
  if (!isMediaKind(kindValue)) {
    adminNotice("资源类型无效", "warning", mediaReturnPath(formData));
  }
  const folder = String(formData.get("folder") || "");
  const parent = folder.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  let deleted: boolean;
  try {
    deleted = await deleteMediaFolder(kindValue, folder);
  } catch (error) {
    adminNotice(mediaFolderMessage(error), "warning", mediaReturnPath(formData));
  }
  revalidatePath("/media");
  revalidatePath("/admin/media");
  adminNotice(
    deleted ? "空文件夹已删除" : "文件夹不存在",
    deleted ? "success" : "warning",
    mediaFolderReturnPath(formData, kindValue, parent),
  );
}

export async function createAdminUserAction(formData: FormData) {
  const returnPath = listReturnPath(formData, "/admin/users");
  await requireAdminRequest();
  const username = String(formData.get("username") || "").trim();
  const displayName = String(formData.get("displayName") || "").trim() || username;
  const password = String(formData.get("password") || "");
  const status = formData.get("status") === "disabled"
    ? "disabled"
    : formData.get("status") === "pending"
      ? "pending"
      : "active";
  const role = formData.get("role") === "admin" ? "admin" : "user";

  const usernameError = validateUsername(username);
  if (usernameError) {
    adminNotice(usernameError, "warning", returnPath);
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    adminNotice(displayNameError, "warning", returnPath);
  }
  const passwordError = validatePassword(password);
  if (passwordError) {
    adminNotice(passwordError, "warning", returnPath);
  }

  try {
    createUserRecord({
      username,
      displayName,
      passwordHash: hashUserPassword(password),
      status,
      role,
      sodaBalance: Math.max(Math.floor(Number(formData.get("sodaBalance")) || 0), 0),
      sodaExperience: Math.max(Math.floor(Number(formData.get("sodaExperience")) || 0), 0),
      cookieBalance: Math.max(Math.floor(Number(formData.get("cookieBalance")) || 0), 0),
    });
  } catch (error) {
    if (isUsernameConflict(error)) {
      adminNotice("用户名已存在", "warning", returnPath);
    }
    console.error("Failed to create admin-managed user", error);
    adminNotice("用户创建失败，请检查数据库状态", "error", returnPath);
  }

  revalidatePath("/admin/users");
  adminNotice("用户已创建", "success", returnPath);
}

export async function updateAdminUserAction(
  formData: FormData,
): Promise<MutationResult<{ user: UserProfile }>> {
  const session = await requireAdminRequest();
  const userId = Number(formData.get("userId"));
  const displayName = String(formData.get("displayName") || "").trim();
  const status = formData.get("status") === "disabled"
    ? "disabled"
    : formData.get("status") === "pending"
      ? "pending"
      : "active";
  const role = formData.get("role") === "admin" ? "admin" : "user";
  const newPassword = String(formData.get("newPassword") || "");
  const sodaBalance = Math.max(Math.floor(Number(formData.get("sodaBalance")) || 0), 0);
  const sodaExperience = Math.max(Math.floor(Number(formData.get("sodaExperience")) || 0), sodaBalance, 0);
  const cookieBalance = Math.max(Math.floor(Number(formData.get("cookieBalance")) || 0), 0);

  if (!Number.isInteger(userId) || userId < 1) {
    return mutationResult(false, "用户不存在", "warning");
  }
  const displayNameError = validateDisplayName(displayName);
  if (displayNameError) {
    return mutationResult(false, displayNameError, "warning");
  }
  const passwordError = newPassword ? validatePassword(newPassword) : null;
  if (passwordError) {
    return mutationResult(false, passwordError, "warning");
  }

  const previousUser = getUserById(userId);
  const updated = updateUserRecord({
    id: userId,
    displayName,
    status,
    role,
    passwordHash: newPassword ? hashUserPassword(newPassword) : undefined,
  });
  if (!updated) {
    return mutationResult(false, "用户不存在", "warning");
  }
  updateUserGrowth({
    userId,
    sodaBalance,
    sodaExperience,
    cookieBalance,
    adminName: session.username,
  });
  if (newPassword || status === "disabled" || previousUser?.role !== role) {
    deleteUserSessions(userId);
  }
  const user = getUserById(userId);
  return user
    ? mutationResult(true, "用户已更新", "success", { user })
    : mutationResult(false, "用户不存在", "warning");
}

function adminUserEntitlementPath(userId: number): string {
  return `/admin/users/${userId}?view=rights`;
}

export async function grantAdminUserEntitlementAction(formData: FormData) {
  const session = await requireAdminRequest();
  const userId = Number(formData.get("userId"));
  if (!Number.isInteger(userId) || userId < 1 || !getUserById(userId)) {
    adminNotice("用户不存在", "warning", "/admin/users");
  }
  const durationDays = Math.min(Math.max(Math.floor(Number(formData.get("durationDays") || 0)), 0), 3650);
  const definition = parseEntitlementDefinition({
    targetType: formData.get("targetType"),
    targetId: formData.get("targetId"),
    rights: formData.getAll("rights").map(String),
    durationSeconds: durationDays ? durationDays * 86_400 : null,
  });
  if (!definition) {
    adminNotice("请选择资源和至少一项权限", "warning", adminUserEntitlementPath(userId));
  }
  grantUserEntitlement({ userId, definition, grantedBy: session.username });
  revalidatePath("/account");
  revalidatePath(`/admin/users/${userId}`);
  adminNotice("权益已授予", "success", adminUserEntitlementPath(userId));
}

export async function updateAdminUserEntitlementAction(formData: FormData) {
  const session = await requireAdminRequest();
  const userId = Number(formData.get("userId"));
  const entitlementId = Number(formData.get("entitlementId"));
  const expiryMode = String(formData.get("expiryMode") || "keep");
  const durationDays = /^\d+$/.test(expiryMode) ? Math.min(Math.max(Number(expiryMode), 1), 3650) : 0;
  const expiresAt = expiryMode === "keep"
    ? undefined
    : expiryMode === "permanent"
      ? null
      : durationDays
        ? new Date(Date.now() + durationDays * 86_400_000).toISOString()
        : undefined;
  const updated = updateUserEntitlement({
    id: entitlementId,
    userId,
    rights: formData.getAll("rights").map(String),
    expiresAt,
    grantedBy: session.username,
  });
  revalidatePath("/account");
  revalidatePath(`/admin/users/${userId}`);
  adminNotice(updated ? "权益已更新" : "权益不存在或未选择权限", updated ? "success" : "warning", adminUserEntitlementPath(userId));
}

export async function revokeAdminUserEntitlementAction(formData: FormData) {
  await requireAdminRequest();
  const userId = Number(formData.get("userId"));
  const entitlementId = Number(formData.get("entitlementId"));
  const revoked = revokeUserEntitlement(entitlementId, userId);
  revalidatePath("/account");
  revalidatePath(`/admin/users/${userId}`);
  adminNotice(revoked ? "权益已撤销" : "权益不存在", revoked ? "success" : "warning", adminUserEntitlementPath(userId));
}

export async function saveUserLevelsAction(formData: FormData) {
  await requireAdminRequest();
  const levels = Array.from({ length: 7 }, (_, level) => ({
    level,
    name: String(formData.get(`levelName:${level}`) || "").trim(),
    sodaRequired: level < 2 ? 0 : Math.max(Math.floor(Number(formData.get(`sodaRequired:${level}`)) || 0), 1),
    videoConcurrencyLimit: level === 0
      ? 0
      : Math.min(Math.max(Math.floor(Number(formData.get(`videoConcurrencyLimit:${level}`)) || 0), 0), 20),
    dailyVideoDownloadLimit: level === 0
      ? 0
      : Math.min(Math.max(Math.floor(Number(formData.get(`dailyVideoDownloadLimit:${level}`)) || 0), 0), 1_000),
    permissions: formData.getAll(`permissions:${level}`).map(String),
  }));
  if (levels.some((level) => !level.name)) {
    adminNotice("等级名称不能为空", "warning", "/admin/users/levels");
  }
  if (levels.some((level, index) => index > 1 && level.sodaRequired <= levels[index - 1].sodaRequired)) {
    adminNotice("每一级所需累计苏打必须递增", "warning", "/admin/users/levels");
  }
  let saved = 0;
  for (const level of levels) {
    if (saveUserLevelDefinition({
      level: level.level,
      name: level.name,
      sodaRequired: level.sodaRequired,
      videoConcurrencyLimit: level.videoConcurrencyLimit,
      dailyVideoDownloadLimit: level.dailyVideoDownloadLimit,
      permissions: level.permissions,
    })) {
      saved += 1;
    }
  }
  if (saved !== 7) {
    adminNotice("等级名称不能为空", "warning", "/admin/users/levels");
  }
  recalculateUserLevels();
  revalidatePath("/account");
  revalidatePath("/admin/users");
  revalidatePath("/admin/users/levels");
  adminNotice("等级权限已保存", "success", "/admin/users/levels");
}

export async function updateAdminUserStatusAction(
  formData: FormData,
): Promise<MutationResult<{ user: UserProfile }>> {
  await requireAdminRequest();
  const userId = Number(formData.get("userId"));
  const status = formData.get("status") === "disabled"
    ? "disabled"
    : formData.get("status") === "pending"
      ? "pending"
      : "active";

  if (!Number.isInteger(userId) || userId < 1 || !updateUserStatus(userId, status)) {
    return mutationResult(false, "用户不存在", "warning");
  }
  if (status === "disabled") {
    deleteUserSessions(userId);
  }
  const user = getUserById(userId);
  return user
    ? mutationResult(true, status === "active" ? "用户已启用" : "用户已停用", "success", { user })
    : mutationResult(false, "用户不存在", "warning");
}

export async function deleteAdminUsersAction(
  formData: FormData,
): Promise<MutationResult<{ deletedIds: number[] }>> {
  await requireAdminRequest();
  const ids = formData
    .getAll("userIds")
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);

  if (!ids.length) {
    return mutationResult(false, "请选择要删除的用户", "warning");
  }

  const deleted = deleteUserIds(ids);
  const deletedIds = ids.filter((id) => !getUserById(id));
  return mutationResult(
    deleted > 0,
    `已删除 ${deleted} 个用户`,
    deleted ? "success" : "warning",
    { deletedIds },
  );
}

export async function deleteAdminUserHistoryAction(formData: FormData) {
  const userId = Number(formData.get("userId"));
  const returnPath = Number.isInteger(userId) && userId > 0 ? userDetailReturnPath(formData, userId) : "/admin/users";
  await requireAdminRequest();
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
  revalidatePath(`/admin/users/${userId}`);
  adminNotice(`已删除 ${deleted} 条浏览记录`, deleted ? "success" : "warning", returnPath);
}

export async function clearAdminUserHistoryAction(formData: FormData) {
  const userId = Number(formData.get("userId"));
  const returnPath = Number.isInteger(userId) && userId > 0 ? userDetailReturnPath(formData, userId) : "/admin/users";
  await requireAdminRequest();
  if (!Number.isInteger(userId) || userId < 1) {
    adminNotice("用户不存在", "warning", "/admin/users");
  }
  const deleted = clearBrowseHistory(userId);
  revalidatePath(`/admin/users/${userId}`);
  adminNotice(`已删除 ${deleted} 条浏览记录`, deleted ? "success" : "warning", returnPath);
}
