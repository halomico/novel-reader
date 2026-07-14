import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type AdminTheme = "system" | "light" | "dark";
export type UserLoginCaptchaMode = "off" | "image" | "slider";
export type SiteIconMimeType = "" | "image/png" | "image/jpeg" | "image/webp" | "image/x-icon";
export type VideoThumbnailMode = "single" | "carousel";
export type RelatedVideoMode = "next" | "random";

export type IpRateLimitRule = {
  id: string;
  enabled: boolean;
  scope: "all" | "guest" | "user";
  queryType: "all" | "short";
  windowSeconds: number;
  maxRequests: number;
  banMode: "none" | "temporary" | "permanent";
  banSeconds: number;
};

export type SearchRateLimitRule = IpRateLimitRule;

export type AdminLoginRecord = {
  username: string;
  ip: string;
  userAgent: string;
  loggedAt: string;
};

export type SiteSettings = {
  siteName: string;
  siteTitle: string;
  settingsPreviewText: string;
  siteIconFileName: string;
  siteIconMimeType: SiteIconMimeType;
  siteIconUpdatedAt: string;
  readerDefaultFontSize: number;
  adminUsername: string;
  adminPasswordHash: string;
  adminPasswordSha256: string;
  adminLoginRecords: AdminLoginRecord[];
  adminAllowedIps: string;
  adminBlockedIps: string;
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
  noticeDisplaySeconds: number;
  noticeStayVisibleAfterBlur: boolean;
  showProgressBars: boolean;
  frontendAutoIndexEnabled: boolean;
  frontendSearchConcurrencyLimit: number;
  globalSearchMaxResults: number;
  searchRateLimitPerMinute: number;
  searchShortQueryRateLimitPerMinute: number;
  searchRateLimitRules: SearchRateLimitRule[];
  userLoginEnabled: boolean;
  userLoginCaptchaMode: UserLoginCaptchaMode;
  userRegistrationEnabled: boolean;
  userDailyRegistrationLimitPerIp: number;
  userSearchRateLimitPerMinute: number;
  userAvatarMaxBytes: number;
  analyticsEnabled: boolean;
  analyticsRealtimeLimit: number;
  videoLibraryEnabled: boolean;
  audioLibraryEnabled: boolean;
  fileLibraryEnabled: boolean;
  guestLibraryNavEnabled: boolean;
  guestVideoNavEnabled: boolean;
  guestAudioNavEnabled: boolean;
  guestFileNavEnabled: boolean;
  videoThumbnailMode: VideoThumbnailMode;
  videoThumbnailSinglePercent: number;
  videoThumbnailCarouselFrames: number;
  videoThumbnailCarouselIntervalSeconds: number;
  relatedVideoCount: number;
  relatedVideoMode: RelatedVideoMode;
  contentRateLimitPerMinute: number;
  contentRateLimitWindowSeconds: number;
  contentRateLimitRules: IpRateLimitRule[];
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
  siteIconFileName: "",
  siteIconMimeType: "",
  siteIconUpdatedAt: "",
  readerDefaultFontSize: 17,
  adminUsername: "",
  adminPasswordHash: "",
  adminPasswordSha256: "",
  adminLoginRecords: [],
  adminAllowedIps: "",
  adminBlockedIps: "",
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
  noticeDisplaySeconds: 0,
  noticeStayVisibleAfterBlur: false,
  showProgressBars: true,
  frontendAutoIndexEnabled: true,
  frontendSearchConcurrencyLimit: 0,
  globalSearchMaxResults: 0,
  searchRateLimitPerMinute: 0,
  searchShortQueryRateLimitPerMinute: 0,
  searchRateLimitRules: [],
  userLoginEnabled: true,
  userLoginCaptchaMode: "off",
  userRegistrationEnabled: true,
  userDailyRegistrationLimitPerIp: 0,
  userSearchRateLimitPerMinute: 0,
  userAvatarMaxBytes: 0,
  analyticsEnabled: false,
  analyticsRealtimeLimit: 0,
  videoLibraryEnabled: true,
  audioLibraryEnabled: true,
  fileLibraryEnabled: true,
  guestLibraryNavEnabled: false,
  guestVideoNavEnabled: false,
  guestAudioNavEnabled: false,
  guestFileNavEnabled: false,
  videoThumbnailMode: "single",
  videoThumbnailSinglePercent: 33,
  videoThumbnailCarouselFrames: 3,
  videoThumbnailCarouselIntervalSeconds: 3,
  relatedVideoCount: 5,
  relatedVideoMode: "next",
  contentRateLimitPerMinute: 0,
  contentRateLimitWindowSeconds: 0,
  contentRateLimitRules: [],
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

function cleanCaptchaMode(value: unknown): UserLoginCaptchaMode {
  return value === "image" || value === "slider" ? value : "off";
}

function cleanSiteIconMimeType(value: unknown): SiteIconMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/x-icon" ? value : "";
}

function cleanVideoThumbnailMode(value: unknown): VideoThumbnailMode {
  return value === "carousel" ? "carousel" : "single";
}

function cleanRelatedVideoMode(value: unknown): RelatedVideoMode {
  return value === "random" ? "random" : "next";
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeIpRateLimitRules(value: unknown): IpRateLimitRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const usedIds = new Set<string>();
  const rules: IpRateLimitRule[] = [];
  for (const [index, rawRule] of value.slice(0, 20).entries()) {
    if (!rawRule || typeof rawRule !== "object") {
      continue;
    }

    const item = rawRule as Partial<IpRateLimitRule>;
    const baseId = cleanText(item.id).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || `rule-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${baseId}-${suffix}`.slice(0, 48);
      suffix += 1;
    }
    usedIds.add(id);

    rules.push({
      id,
      enabled: cleanBool(item.enabled, true),
      scope: item.scope === "guest" || item.scope === "user" ? item.scope : "all",
      queryType: item.queryType === "short" ? "short" : "all",
      windowSeconds: cleanInt(item.windowSeconds, 60, 1, 86_400),
      maxRequests: cleanInt(item.maxRequests, 30, 1, 100_000),
      banMode: item.banMode === "temporary" || item.banMode === "permanent" ? item.banMode : "none",
      banSeconds: cleanInt(item.banSeconds, 3_600, 60, 31_536_000),
    });
  }

  return rules;
}

function cleanLoginRecords(value: unknown): AdminLoginRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((record) => {
      const item = record as Partial<AdminLoginRecord>;
      return {
        username: cleanText(item.username),
        ip: cleanText(item.ip),
        userAgent: cleanText(item.userAgent).slice(0, 180),
        loggedAt: cleanText(item.loggedAt),
      };
    })
    .filter((record) => record.username && record.ip && record.loggedAt)
    .slice(0, 30);
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
      siteIconFileName: path.basename(cleanText(parsed.siteIconFileName)),
      siteIconMimeType: cleanSiteIconMimeType(parsed.siteIconMimeType),
      siteIconUpdatedAt: cleanText(parsed.siteIconUpdatedAt),
      readerDefaultFontSize: cleanInt(parsed.readerDefaultFontSize, DEFAULT_SETTINGS.readerDefaultFontSize, 5, 50),
      adminUsername: cleanText(parsed.adminUsername),
      adminPasswordHash: cleanText(parsed.adminPasswordHash),
      adminPasswordSha256: cleanText(parsed.adminPasswordSha256),
      adminLoginRecords: cleanLoginRecords(parsed.adminLoginRecords),
      adminAllowedIps: cleanText(parsed.adminAllowedIps),
      adminBlockedIps: cleanText(parsed.adminBlockedIps),
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
      noticeDisplaySeconds: cleanInt(parsed.noticeDisplaySeconds, DEFAULT_SETTINGS.noticeDisplaySeconds, 0, 60),
      noticeStayVisibleAfterBlur: cleanBool(parsed.noticeStayVisibleAfterBlur, DEFAULT_SETTINGS.noticeStayVisibleAfterBlur),
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
      searchRateLimitRules: normalizeIpRateLimitRules(parsed.searchRateLimitRules),
      userLoginEnabled: cleanBool(parsed.userLoginEnabled, DEFAULT_SETTINGS.userLoginEnabled),
      userLoginCaptchaMode: cleanCaptchaMode(parsed.userLoginCaptchaMode),
      userRegistrationEnabled: cleanBool(parsed.userRegistrationEnabled, DEFAULT_SETTINGS.userRegistrationEnabled),
      userDailyRegistrationLimitPerIp: cleanInt(
        parsed.userDailyRegistrationLimitPerIp,
        DEFAULT_SETTINGS.userDailyRegistrationLimitPerIp,
        0,
        100,
      ),
      userSearchRateLimitPerMinute: cleanInt(
        parsed.userSearchRateLimitPerMinute,
        DEFAULT_SETTINGS.userSearchRateLimitPerMinute,
        0,
        600,
      ),
      userAvatarMaxBytes: cleanInt(parsed.userAvatarMaxBytes, DEFAULT_SETTINGS.userAvatarMaxBytes, 0, 10 * 1024 ** 2),
      analyticsEnabled: cleanBool(parsed.analyticsEnabled, DEFAULT_SETTINGS.analyticsEnabled),
      analyticsRealtimeLimit: cleanInt(parsed.analyticsRealtimeLimit, DEFAULT_SETTINGS.analyticsRealtimeLimit, 0, 2000),
      videoLibraryEnabled: cleanBool(parsed.videoLibraryEnabled, DEFAULT_SETTINGS.videoLibraryEnabled),
      audioLibraryEnabled: cleanBool(parsed.audioLibraryEnabled, DEFAULT_SETTINGS.audioLibraryEnabled),
      fileLibraryEnabled: cleanBool(parsed.fileLibraryEnabled, DEFAULT_SETTINGS.fileLibraryEnabled),
      guestLibraryNavEnabled: cleanBool(parsed.guestLibraryNavEnabled, DEFAULT_SETTINGS.guestLibraryNavEnabled),
      guestVideoNavEnabled: cleanBool(parsed.guestVideoNavEnabled, DEFAULT_SETTINGS.guestVideoNavEnabled),
      guestAudioNavEnabled: cleanBool(parsed.guestAudioNavEnabled, DEFAULT_SETTINGS.guestAudioNavEnabled),
      guestFileNavEnabled: cleanBool(parsed.guestFileNavEnabled, DEFAULT_SETTINGS.guestFileNavEnabled),
      videoThumbnailMode: cleanVideoThumbnailMode(parsed.videoThumbnailMode),
      videoThumbnailSinglePercent: cleanInt(parsed.videoThumbnailSinglePercent, DEFAULT_SETTINGS.videoThumbnailSinglePercent, 1, 99),
      videoThumbnailCarouselFrames: cleanInt(parsed.videoThumbnailCarouselFrames, DEFAULT_SETTINGS.videoThumbnailCarouselFrames, 2, 8),
      videoThumbnailCarouselIntervalSeconds: cleanInt(
        parsed.videoThumbnailCarouselIntervalSeconds,
        DEFAULT_SETTINGS.videoThumbnailCarouselIntervalSeconds,
        1,
        15,
      ),
      relatedVideoCount: cleanInt(parsed.relatedVideoCount, DEFAULT_SETTINGS.relatedVideoCount, 0, 20),
      relatedVideoMode: cleanRelatedVideoMode(parsed.relatedVideoMode),
      contentRateLimitPerMinute: cleanInt(parsed.contentRateLimitPerMinute, DEFAULT_SETTINGS.contentRateLimitPerMinute, 0, 600),
      contentRateLimitWindowSeconds: cleanInt(parsed.contentRateLimitWindowSeconds, DEFAULT_SETTINGS.contentRateLimitWindowSeconds, 0, 3600),
      contentRateLimitRules: normalizeIpRateLimitRules(parsed.contentRateLimitRules),
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
  const tempPath = `${settingsPath}.${process.pid}-${crypto.randomBytes(5).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(tempPath, settingsPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}
