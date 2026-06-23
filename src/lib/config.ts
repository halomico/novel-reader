import path from "node:path";
import { readSiteSettings } from "./site-settings";

function resolveFromProject(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getLibraryDir(): string {
  return resolveFromProject(process.env.NOVEL_LIBRARY_DIR || "./library/books");
}

export function getDatabasePath(): string {
  return resolveFromProject(process.env.DATABASE_PATH || "./data/novels.db");
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
    "夜色像一页慢慢翻开的纸，灯下的字迹温润清晰。读到安静处，页面不抢戏，只把故事稳稳托住。"
  );
}

function readIntConfig(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function getGlobalSearchMaxResults(): number {
  return readIntConfig("GLOBAL_SEARCH_MAX_RESULTS", 200, 1, 1000);
}

export function getSearchResultsPageSize(): number {
  return readIntConfig("SEARCH_RESULTS_PAGE_SIZE", 20, 1, 50);
}

export function getSearchRateLimitPerMinute(): number {
  return readIntConfig("SEARCH_RATE_LIMIT_PER_MINUTE", 8, 1, 120);
}

export function getSearchShortQueryRateLimitPerMinute(): number {
  return readIntConfig("SEARCH_SHORT_QUERY_RATE_LIMIT_PER_MINUTE", 3, 1, 120);
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

export function isAdminEnabled(): boolean {
  return readBoolConfig("ADMIN_ENABLED", true);
}

export function getAdminUsername(): string {
  return process.env.ADMIN_USERNAME || "admin";
}

export function getAdminPassword(): string {
  return process.env.ADMIN_PASSWORD || "";
}

export function getAdminPasswordSha256(): string {
  return process.env.ADMIN_PASSWORD_SHA256 || "";
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

export function getAdminRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().adminRateLimitPerMinute, "ADMIN_RATE_LIMIT_PER_MINUTE", 60, 1, 600);
}

export function getAdminLoginRateLimitPerMinute(): number {
  return readSettingInt(readSiteSettings().adminLoginRateLimitPerMinute, "ADMIN_LOGIN_RATE_LIMIT_PER_MINUTE", 6, 1, 120);
}

export function getAdminAllowedIps(): string[] {
  const settings = readSiteSettings();
  return splitList(settings.adminAllowedIps || process.env.ADMIN_ALLOWED_IPS || "");
}

export function getAdminBlockedIps(): string[] {
  const settings = readSiteSettings();
  return splitList(settings.adminBlockedIps || process.env.ADMIN_BLOCKED_IPS || "");
}

export function getAdminOutboundAllowedIps(): string[] {
  const settings = readSiteSettings();
  return splitList(settings.adminOutboundAllowedIps || process.env.ADMIN_OUTBOUND_ALLOWED_IPS || "");
}

export function getAdminOutboundBlockedIps(): string[] {
  const settings = readSiteSettings();
  return splitList(settings.adminOutboundBlockedIps || process.env.ADMIN_OUTBOUND_BLOCKED_IPS || "");
}

export function getConfiguredPort(): number {
  return readIntConfig("PORT", 3000, 1, 65535);
}

export function getConfiguredPaths() {
  return {
    libraryDir: getLibraryDir(),
    databasePath: getDatabasePath(),
    adminSettingsPath: process.env.ADMIN_SETTINGS_PATH || "./data/admin-settings.json",
  };
}
