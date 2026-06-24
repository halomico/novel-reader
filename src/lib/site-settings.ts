import fs from "node:fs";
import path from "node:path";

export type AdminTheme = "system" | "light" | "dark";

export type SiteSettings = {
  siteName: string;
  siteTitle: string;
  settingsPreviewText: string;
  adminUsername: string;
  adminPasswordSha256: string;
  adminAllowedIps: string;
  adminBlockedIps: string;
  adminOutboundAllowedIps: string;
  adminOutboundBlockedIps: string;
  adminRateLimitPerMinute: number;
  adminLoginRateLimitPerMinute: number;
  adminLoginRateLimitEnabled: boolean;
  adminLoginRateLimitBanEnabled: boolean;
  adminOperationRateLimitEnabled: boolean;
  adminOperationRateLimitPerMinute: number;
  adminOperationRateLimitBanEnabled: boolean;
  adminTheme: AdminTheme;
  catalogPageSize: number;
  searchResultsPageSize: number;
  adminBookPageSize: number;
  adminIndexPageSize: number;
  showProgressBars: boolean;
  frontendAutoIndexEnabled: boolean;
  frontendSearchConcurrencyLimit: number;
  globalSearchMaxResults: number;
  searchRateLimitPerMinute: number;
  searchShortQueryRateLimitPerMinute: number;
  contentRateLimitPerMinute: number;
  contentRateLimitWindowSeconds: number;
  contentBlockHeadlessBrowsers: boolean;
  contentIndexMaxSegments: number;
  contentIndexSoftLimitBytes: number;
  contentIndexHardLimitBytes: number;
  manualIndexMaxSegmentsEnabled: boolean;
  manualIndexMaxSegments: number;
};

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "",
  siteTitle: "",
  settingsPreviewText: "",
  adminUsername: "",
  adminPasswordSha256: "",
  adminAllowedIps: "",
  adminBlockedIps: "",
  adminOutboundAllowedIps: "",
  adminOutboundBlockedIps: "",
  adminRateLimitPerMinute: 0,
  adminLoginRateLimitPerMinute: 0,
  adminLoginRateLimitEnabled: true,
  adminLoginRateLimitBanEnabled: true,
  adminOperationRateLimitEnabled: false,
  adminOperationRateLimitPerMinute: 0,
  adminOperationRateLimitBanEnabled: false,
  adminTheme: "system",
  catalogPageSize: 0,
  searchResultsPageSize: 0,
  adminBookPageSize: 0,
  adminIndexPageSize: 0,
  showProgressBars: true,
  frontendAutoIndexEnabled: true,
  frontendSearchConcurrencyLimit: 0,
  globalSearchMaxResults: 0,
  searchRateLimitPerMinute: 0,
  searchShortQueryRateLimitPerMinute: 0,
  contentRateLimitPerMinute: 0,
  contentRateLimitWindowSeconds: 0,
  contentBlockHeadlessBrowsers: true,
  contentIndexMaxSegments: 0,
  contentIndexSoftLimitBytes: 0,
  contentIndexHardLimitBytes: 0,
  manualIndexMaxSegmentsEnabled: false,
  manualIndexMaxSegments: 0,
};

function resolveFromProject(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getSiteSettingsPath(): string {
  return resolveFromProject(process.env.ADMIN_SETTINGS_PATH || "./data/admin-settings.json");
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanInt(value: unknown, fallback: number, min: number, max: number): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(numericValue), min), max);
}

function cleanTheme(value: unknown): AdminTheme {
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function readSiteSettings(): SiteSettings {
  const settingsPath = getSiteSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Partial<SiteSettings>;
    return {
      siteName: cleanText(parsed.siteName),
      siteTitle: cleanText(parsed.siteTitle),
      settingsPreviewText: cleanText(parsed.settingsPreviewText),
      adminUsername: cleanText(parsed.adminUsername),
      adminPasswordSha256: cleanText(parsed.adminPasswordSha256),
      adminAllowedIps: cleanText(parsed.adminAllowedIps),
      adminBlockedIps: cleanText(parsed.adminBlockedIps),
      adminOutboundAllowedIps: cleanText(parsed.adminOutboundAllowedIps),
      adminOutboundBlockedIps: cleanText(parsed.adminOutboundBlockedIps),
      adminRateLimitPerMinute: cleanInt(parsed.adminRateLimitPerMinute, DEFAULT_SETTINGS.adminRateLimitPerMinute, 0, 600),
      adminLoginRateLimitPerMinute: cleanInt(parsed.adminLoginRateLimitPerMinute, DEFAULT_SETTINGS.adminLoginRateLimitPerMinute, 0, 120),
      adminLoginRateLimitEnabled: cleanBool(parsed.adminLoginRateLimitEnabled, DEFAULT_SETTINGS.adminLoginRateLimitEnabled),
      adminLoginRateLimitBanEnabled: cleanBool(parsed.adminLoginRateLimitBanEnabled, DEFAULT_SETTINGS.adminLoginRateLimitBanEnabled),
      adminOperationRateLimitEnabled: cleanBool(parsed.adminOperationRateLimitEnabled, DEFAULT_SETTINGS.adminOperationRateLimitEnabled),
      adminOperationRateLimitPerMinute: cleanInt(
        parsed.adminOperationRateLimitPerMinute,
        DEFAULT_SETTINGS.adminOperationRateLimitPerMinute,
        0,
        600,
      ),
      adminOperationRateLimitBanEnabled: cleanBool(parsed.adminOperationRateLimitBanEnabled, DEFAULT_SETTINGS.adminOperationRateLimitBanEnabled),
      adminTheme: cleanTheme(parsed.adminTheme),
      catalogPageSize: cleanInt(parsed.catalogPageSize, DEFAULT_SETTINGS.catalogPageSize, 0, 100),
      searchResultsPageSize: cleanInt(parsed.searchResultsPageSize, DEFAULT_SETTINGS.searchResultsPageSize, 0, 100),
      adminBookPageSize: cleanInt(parsed.adminBookPageSize, DEFAULT_SETTINGS.adminBookPageSize, 0, 200),
      adminIndexPageSize: cleanInt(parsed.adminIndexPageSize, DEFAULT_SETTINGS.adminIndexPageSize, 0, 200),
      showProgressBars: cleanBool(parsed.showProgressBars, DEFAULT_SETTINGS.showProgressBars),
      frontendAutoIndexEnabled: cleanBool(parsed.frontendAutoIndexEnabled, DEFAULT_SETTINGS.frontendAutoIndexEnabled),
      frontendSearchConcurrencyLimit: cleanInt(parsed.frontendSearchConcurrencyLimit, DEFAULT_SETTINGS.frontendSearchConcurrencyLimit, 0, 50),
      globalSearchMaxResults: cleanInt(parsed.globalSearchMaxResults, DEFAULT_SETTINGS.globalSearchMaxResults, 0, 1000),
      searchRateLimitPerMinute: cleanInt(parsed.searchRateLimitPerMinute, DEFAULT_SETTINGS.searchRateLimitPerMinute, 0, 120),
      searchShortQueryRateLimitPerMinute: cleanInt(
        parsed.searchShortQueryRateLimitPerMinute,
        DEFAULT_SETTINGS.searchShortQueryRateLimitPerMinute,
        0,
        120,
      ),
      contentRateLimitPerMinute: cleanInt(parsed.contentRateLimitPerMinute, DEFAULT_SETTINGS.contentRateLimitPerMinute, 0, 600),
      contentRateLimitWindowSeconds: cleanInt(parsed.contentRateLimitWindowSeconds, DEFAULT_SETTINGS.contentRateLimitWindowSeconds, 0, 3600),
      contentBlockHeadlessBrowsers: cleanBool(parsed.contentBlockHeadlessBrowsers, DEFAULT_SETTINGS.contentBlockHeadlessBrowsers),
      contentIndexMaxSegments: cleanInt(parsed.contentIndexMaxSegments, DEFAULT_SETTINGS.contentIndexMaxSegments, 0, 100000),
      contentIndexSoftLimitBytes: cleanInt(parsed.contentIndexSoftLimitBytes, DEFAULT_SETTINGS.contentIndexSoftLimitBytes, 0, 10 * 1024 ** 3),
      contentIndexHardLimitBytes: cleanInt(parsed.contentIndexHardLimitBytes, DEFAULT_SETTINGS.contentIndexHardLimitBytes, 0, 10 * 1024 ** 3),
      manualIndexMaxSegmentsEnabled: cleanBool(parsed.manualIndexMaxSegmentsEnabled, DEFAULT_SETTINGS.manualIndexMaxSegmentsEnabled),
      manualIndexMaxSegments: cleanInt(parsed.manualIndexMaxSegments, DEFAULT_SETTINGS.manualIndexMaxSegments, 0, 1000000),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSiteSettings(settings: SiteSettings) {
  const settingsPath = getSiteSettingsPath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}
