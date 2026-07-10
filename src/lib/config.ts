import path from "node:path";
import { readSiteSettings, type IpRateLimitRule, type UserLoginCaptchaMode } from "./site-settings";

function resolveFromProject(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getLibraryDir(): string {
  return resolveFromProject(process.env.NOVEL_LIBRARY_DIR || "./library/books");
}

export function getDatabasePath(): string {
  return resolveFromProject(process.env.DATABASE_PATH || "./data/novels.db");
}

export function getContentIndexDatabasePath(): string {
  return resolveFromProject(process.env.CONTENT_INDEX_DB_PATH || "./data/content-index.db");
}

export function getSiteName(): string {
  return readSiteSettings().siteName || process.env.SITE_NAME || "墨卷";
}

export function getSiteTitle(): string {
  return readSiteSettings().siteTitle || process.env.SITE_TITLE || getSiteName();
}

export function getSettingsPreviewText(): string {
  const configuredPreview = readSiteSettings().settingsPreviewText;
  if (configuredPreview) {
    return configuredPreview;
  }

  return (
    process.env.SETTINGS_PREVIEW_TEXT ||
    "夜色像一页慢慢翻开的纸，灯下的字迹温润清明。读到安静处，页面不抢戏，只把故事稳稳托住。"
  );
}

export function getReaderDefaultFontSize(): number {
  return readSiteSettings().readerDefaultFontSize;
}

function readIntConfig(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function readSettingInt(settingValue: number, envName: string, fallback: number, min: number, max: number): number {
  if (Number.isFinite(settingValue) && settingValue >= min) {
    return Math.min(Math.max(Math.floor(settingValue), min), max);
  }
  return readIntConfig(envName, fallback, min, max);
}

function readBoolConfig(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getGlobalSearchMaxResults(): number {
  return readSettingInt(readSiteSettings().globalSearchMaxResults, "GLOBAL_SEARCH_MAX_RESULTS", 200, 1, 1000);
}

export function getCatalogPageSize(): number {
  return readSettingInt(readSiteSettings().catalogPageSize, "CATALOG_PAGE_SIZE", 15, 1, 100);
}

export function getSearchResultsPageSize(): number {
  return readSettingInt(readSiteSettings().searchResultsPageSize, "SEARCH_RESULTS_PAGE_SIZE", 20, 1, 100);
}

export function getAdminBookPageSize(): number {
  return readSettingInt(readSiteSettings().adminBookPageSize, "ADMIN_BOOK_PAGE_SIZE", 20, 1, 200);
}

export function getAdminIndexPageSize(): number {
  return readSettingInt(readSiteSettings().adminIndexPageSize, "ADMIN_INDEX_PAGE_SIZE", 30, 1, 200);
}

export function getNoticeDisplaySeconds(): number {
  return readSettingInt(readSiteSettings().noticeDisplaySeconds, "NOTICE_DISPLAY_SECONDS", 5, 0, 60);
}

export function shouldNoticeStayVisibleAfterBlur(): boolean {
  return readSiteSettings().noticeStayVisibleAfterBlur || readBoolConfig("NOTICE_STAY_VISIBLE_AFTER_BLUR", false);
}

export function getSearchRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().searchRateLimitPerMinute, "SEARCH_RATE_LIMIT_PER_MINUTE", 8, 1, 120);
}

export function getSearchShortQueryRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().searchShortQueryRateLimitPerMinute, "SEARCH_SHORT_QUERY_RATE_LIMIT_PER_MINUTE", 3, 1, 120);
}

export function getUserSearchRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().userSearchRateLimitPerMinute, "USER_SEARCH_RATE_LIMIT_PER_MINUTE", 30, 1, 600);
}

export function getSearchRateLimitRules(): IpRateLimitRule[] {
  const settings = readSiteSettings();
  if (settings.searchRateLimitRules.length > 0) {
    return settings.searchRateLimitRules;
  }

  return [
    {
      id: "guest-general",
      enabled: true,
      scope: "guest",
      queryType: "all",
      windowSeconds: 60,
      maxRequests: getSearchRateLimitPerMinute(),
      banMode: "none",
      banSeconds: 3_600,
    },
    {
      id: "guest-short",
      enabled: true,
      scope: "guest",
      queryType: "short",
      windowSeconds: 60,
      maxRequests: getSearchShortQueryRateLimitPerMinute(),
      banMode: "none",
      banSeconds: 3_600,
    },
  ];
}

export function isUserLoginEnabled(): boolean {
  return readSiteSettings().userLoginEnabled && readBoolConfig("USER_LOGIN_ENABLED", true);
}

export function getUserLoginCaptchaMode(): UserLoginCaptchaMode {
  return readSiteSettings().userLoginCaptchaMode;
}

export function isUserRegistrationEnabled(): boolean {
  return readSiteSettings().userRegistrationEnabled && readBoolConfig("USER_REGISTRATION_ENABLED", true);
}

export function getUserDailyRegistrationLimitPerIp(): number {
  return readSettingInt(readSiteSettings().userDailyRegistrationLimitPerIp, "USER_DAILY_REGISTRATION_LIMIT_PER_IP", 2, 0, 100);
}

export function getUserAvatarMaxBytes(): number {
  return readSettingInt(readSiteSettings().userAvatarMaxBytes, "USER_AVATAR_MAX_BYTES", 1048576, 1, 10 * 1024 ** 2);
}

export function isAnalyticsEnabled(): boolean {
  return readSiteSettings().analyticsEnabled && readBoolConfig("ANALYTICS_ENABLED", true);
}

export function getAnalyticsRealtimeLimit(): number {
  return readSettingInt(readSiteSettings().analyticsRealtimeLimit, "ANALYTICS_REALTIME_LIMIT", 300, 30, 2000);
}

export function getFrontendSearchConcurrencyLimit(): number {
  return readSettingInt(readSiteSettings().frontendSearchConcurrencyLimit, "FRONTEND_SEARCH_CONCURRENCY_LIMIT", 10, 1, 50);
}

export function getContentRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().contentRateLimitPerMinute, "CONTENT_RATE_LIMIT_PER_MINUTE", 60, 1, 600);
}

export function getContentRateLimitWindowSeconds(): number {
  return readSettingInt(readSiteSettings().contentRateLimitWindowSeconds, "CONTENT_RATE_LIMIT_WINDOW_SECONDS", 60, 10, 3600);
}

export function getContentRateLimitRules(): IpRateLimitRule[] {
  const settings = readSiteSettings();
  if (settings.contentRateLimitRules.length > 0) {
    return settings.contentRateLimitRules;
  }

  return [
    {
      id: "content-general",
      enabled: true,
      scope: "all",
      queryType: "all",
      windowSeconds: getContentRateLimitWindowSeconds(),
      maxRequests: getContentRateLimitPerMinute(),
      banMode: "none",
      banSeconds: 3_600,
    },
  ];
}

export function shouldBlockHeadlessBrowsers(): boolean {
  return readSiteSettings().contentBlockHeadlessBrowsers && readBoolConfig("CONTENT_BLOCK_HEADLESS_BROWSERS", true);
}

export function getContentIndexMaxSegments(): number {
  return readSettingInt(readSiteSettings().contentIndexMaxSegments, "CONTENT_INDEX_MAX_SEGMENTS", 5000, 1, 100000);
}

export function isFrontendAutoIndexEnabled(): boolean {
  return readSiteSettings().frontendAutoIndexEnabled && readBoolConfig("FRONTEND_AUTO_CONTENT_INDEX", true);
}

export function getContentIndexSoftLimitBytes(): number {
  return readSettingInt(readSiteSettings().contentIndexSoftLimitBytes, "CONTENT_INDEX_SOFT_LIMIT_BYTES", 2684354560, 1, 10 * 1024 ** 3);
}

export function getContentIndexHardLimitBytes(): number {
  const softLimit = getContentIndexSoftLimitBytes();
  return Math.max(
    softLimit,
    readSettingInt(readSiteSettings().contentIndexHardLimitBytes, "CONTENT_INDEX_HARD_LIMIT_BYTES", 3221225472, 1, 10 * 1024 ** 3),
  );
}

export function isManualIndexMaxSegmentsEnabled(): boolean {
  return readSiteSettings().manualIndexMaxSegmentsEnabled;
}

export function getManualIndexMaxSegments(): number {
  return readSettingInt(readSiteSettings().manualIndexMaxSegments, "MANUAL_CONTENT_INDEX_MAX_SEGMENTS", 50000, 1, 1000000);
}

export function getContentIndexTerms(): string[] {
  return splitList(process.env.CONTENT_INDEX_TERMS || "");
}

export function shouldShowProgressBars(): boolean {
  return readSiteSettings().showProgressBars;
}

export function isAdminEnabled(): boolean {
  return readBoolConfig("ADMIN_ENABLED", true);
}

export function getAdminUsername(): string {
  return readSiteSettings().adminUsername || process.env.ADMIN_USERNAME || "admin";
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}

export function getAdminPasswordHash(): string {
  return readSiteSettings().adminPasswordHash;
}

export function getAdminPasswordSha256(): string {
  return readSiteSettings().adminPasswordSha256 || process.env.ADMIN_PASSWORD_SHA256 || "";
}

export function getAdminSessionSecret(): string {
  return process.env.ADMIN_SESSION_SECRET || "";
}

export function getAdminCookieName(): string {
  return process.env.ADMIN_COOKIE_NAME || "novel_admin_session";
}

export function getAdminSessionTtlHours(): number {
  return readIntConfig("ADMIN_SESSION_TTL_HOURS", 12, 1, 168);
}

export function getAdminLoginRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().adminLoginRateLimitPerMinute, "ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE", 6, 1, 120);
}

export function isAdminLoginRateLimitEnabled(): boolean {
  return readSiteSettings().adminLoginRateLimitEnabled;
}

export function shouldAdminLoginRateLimitBan(): boolean {
  return readSiteSettings().adminLoginRateLimitBanEnabled;
}

export function isAdminOperationRateLimitEnabled(): boolean {
  return readSiteSettings().adminOperationRateLimitEnabled || readBoolConfig("ADMIN_OPERATION_RATE_LIMIT_ENABLED", false);
}

export function getAdminOperationRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().adminOperationRateLimitPerMinute, "ADMIN_OPERATION_RATE_LIMIT_PER_MINUTE", 60, 1, 600);
}

export function shouldAdminOperationRateLimitBan(): boolean {
  return readSiteSettings().adminOperationRateLimitBanEnabled;
}

export function getAdminAllowedIps(): string[] {
  const settings = readSiteSettings();
  return splitList(settings.adminAllowedIps || process.env.ADMIN_ALLOWED_IPS || "");
}

export function getAdminBlockedIps(): string[] {
  const settings = readSiteSettings();
  return splitList(settings.adminBlockedIps || process.env.ADMIN_BLOCKED_IPS || "");
}

export function getConfiguredPaths() {
  return {
    libraryDir: getLibraryDir(),
    databasePath: getDatabasePath(),
    contentIndexDatabasePath: process.env.CONTENT_INDEX_DB_PATH || "./data/content-index.db",
    adminSettingsPath: process.env.ADMIN_SETTINGS_PATH || "./data/admin-settings.json",
  };
}
