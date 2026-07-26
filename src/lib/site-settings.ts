import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_HOME_PORTAL_ORDER,
  normalizeHomePortalOrder,
  normalizePublicDisplayHomeCards,
  type HomePortalCardKey,
  type HomePortalContentCardKey,
} from "./home-portal";
import {
  isColorPalette,
  normalizeReaderLineHeight,
  normalizeReaderTagsMode,
  type ColorPalette,
  type ReaderLineHeight,
  type ReaderTagsMode,
} from "./ui-preferences";

export type AdminTheme = "system" | "light" | "dark";
export type BrandLinkTarget = "home" | "novels";
export type CatalogPromotionOrder = "manual-first" | "random-first";
export type AnnouncementCardTarget = "list" | "latest";
export type SiteIconMimeType = "" | "image/png" | "image/jpeg" | "image/webp" | "image/x-icon";
export type RelatedVideoMode = "next" | "random";
export type AudioPlaybackMode = "stop" | "next" | "repeat-one";

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

export type AdminLoginRecord = {
  username: string;
  ip: string;
  userAgent: string;
  loggedAt: string;
};

export type SiteSettings = {
  siteName: string;
  siteTitle: string;
  brandLinkTarget: BrandLinkTarget;
  settingsPreviewText: string;
  siteIconFileName: string;
  siteIconMimeType: SiteIconMimeType;
  siteIconUpdatedAt: string;
  readerDefaultFontSize: number;
  readerDefaultLineHeight: ReaderLineHeight;
  readerDefaultTagsMode: ReaderTagsMode;
  defaultPalette: ColorPalette;
  defaultPaletteRandomEnabled: boolean;
  defaultPaletteRotationMinutes: number;
  adminUsername: string;
  adminPasswordHash: string;
  adminPasswordSha256: string;
  adminLoginRecords: AdminLoginRecord[];
  adminLoginRateLimitPerMinute: number;
  adminLoginRateLimitEnabled: boolean;
  adminIpAllowlistEnabled: boolean;
  adminAllowedNetworks: string[];
  adminTheme: AdminTheme;
  catalogPageSize: number;
  searchResultsPageSize: number;
  adminBookPageSize: number;
  randomCatalogEnabled: boolean;
  manualPinnedNovelsEnabled: boolean;
  randomRecommendationsEnabled: boolean;
  catalogPromotionOrder: CatalogPromotionOrder;
  randomRecommendationCount: number;
  randomRecommendationIntervalMinutes: number;
  noticeDisplaySeconds: number;
  audioDefaultPlaybackMode: AudioPlaybackMode;
  showProgressBars: boolean;
  frontendSearchConcurrencyLimit: number;
  globalSearchMaxResults: number;
  userLoginEnabled: boolean;
  userRegistrationEnabled: boolean;
  userDailyRegistrationLimitPerIp: number;
  userDailyReportLimit: number;
  userAvatarMaxBytes: number;
  stationDisplayName: string;
  announcementCardEnabled: boolean;
  guestAnnouncementCardEnabled: boolean;
  announcementCardTarget: AnnouncementCardTarget;
  homePortalOrder: HomePortalCardKey[];
  publicDisplayHomeCards: HomePortalContentCardKey[];
  analyticsEnabled: boolean;
  analyticsRealtimeLimit: number;
  novelLibraryEnabled: boolean;
  videoLibraryEnabled: boolean;
  audioLibraryEnabled: boolean;
  fileLibraryEnabled: boolean;
  tagLibraryEnabled: boolean;
  advancedTagSearchEnabled: boolean;
  hotwordLinksEnabled: boolean;
  guestLibraryNavEnabled: boolean;
  guestVideoNavEnabled: boolean;
  guestAudioNavEnabled: boolean;
  guestFileNavEnabled: boolean;
  guestTagLibraryNavEnabled: boolean;
  guestAdvancedTagSearchEnabled: boolean;
  guestHotwordLinksEnabled: boolean;
  videoThumbnailSinglePercent: number;
  relatedVideoCount: number;
  relatedVideoMode: RelatedVideoMode;
  contentRateLimitPerMinute: number;
  contentRateLimitWindowSeconds: number;
  contentRateLimitRules: IpRateLimitRule[];
};

type SiteSettingsCache = {
  schemaVersion: number;
  path: string;
  mtimeMs: number;
  size: number;
  value: SiteSettings;
};

type SiteSettingsGlobal = typeof globalThis & {
  siteSettingsCache?: SiteSettingsCache;
};

const SITE_SETTINGS_CACHE_SCHEMA_VERSION = 7;

const DEFAULT_SETTINGS_PREVIEW_TEXT =
  process.env.SETTINGS_PREVIEW_TEXT?.trim() ||
  "夜色像一页慢慢翻开的纸，灯下的字迹温润清明。读到安静处，页面不抢戏，只把故事稳稳托住。";

const LEGACY_SETTING_KEYS = [
  "adminIndexPageSize",
  "frontendAutoIndexEnabled",
  "contentIndexMaxSegments",
  "contentIndexSoftLimitBytes",
  "contentIndexHardLimitBytes",
  "manualIndexMaxSegmentsEnabled",
  "manualIndexMaxSegments",
  "noticeStayVisibleAfterBlur",
  "adminOperationRateLimitEnabled",
  "adminOperationRateLimitPerMinute",
  "adminOperationRateLimitBanEnabled",
  "searchRateLimitPerMinute",
  "searchShortQueryRateLimitPerMinute",
  "searchRateLimitRules",
  "userSearchRateLimitPerMinute",
  "adminAllowedIps",
  "adminBlockedIps",
  "adminLoginRateLimitBanEnabled",
  "contentBlockHeadlessBrowsers",
  "videoThumbnailMode",
  "videoThumbnailCarouselFrames",
  "videoThumbnailCarouselIntervalSeconds",
] as const;

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "",
  siteTitle: "",
  brandLinkTarget: "novels",
  settingsPreviewText: DEFAULT_SETTINGS_PREVIEW_TEXT,
  siteIconFileName: "",
  siteIconMimeType: "",
  siteIconUpdatedAt: "",
  readerDefaultFontSize: 18,
  readerDefaultLineHeight: 1.7,
  readerDefaultTagsMode: "collapsed",
  defaultPalette: "default",
  defaultPaletteRandomEnabled: false,
  defaultPaletteRotationMinutes: 1_440,
  adminUsername: "",
  adminPasswordHash: "",
  adminPasswordSha256: "",
  adminLoginRecords: [],
  adminLoginRateLimitPerMinute: 0,
  adminLoginRateLimitEnabled: true,
  adminIpAllowlistEnabled: false,
  adminAllowedNetworks: [],
  adminTheme: "system",
  catalogPageSize: 0,
  searchResultsPageSize: 0,
  adminBookPageSize: 0,
  randomCatalogEnabled: true,
  manualPinnedNovelsEnabled: true,
  randomRecommendationsEnabled: false,
  catalogPromotionOrder: "manual-first",
  randomRecommendationCount: 8,
  randomRecommendationIntervalMinutes: 360,
  noticeDisplaySeconds: 0,
  audioDefaultPlaybackMode: "next",
  showProgressBars: true,
  frontendSearchConcurrencyLimit: 0,
  globalSearchMaxResults: 0,
  userLoginEnabled: true,
  userRegistrationEnabled: true,
  userDailyRegistrationLimitPerIp: 0,
  userDailyReportLimit: 50,
  userAvatarMaxBytes: 0,
  stationDisplayName: "站务",
  announcementCardEnabled: true,
  guestAnnouncementCardEnabled: true,
  announcementCardTarget: "list",
  homePortalOrder: DEFAULT_HOME_PORTAL_ORDER,
  publicDisplayHomeCards: [],
  analyticsEnabled: false,
  analyticsRealtimeLimit: 0,
  novelLibraryEnabled: true,
  videoLibraryEnabled: true,
  audioLibraryEnabled: true,
  fileLibraryEnabled: true,
  tagLibraryEnabled: true,
  advancedTagSearchEnabled: false,
  hotwordLinksEnabled: true,
  guestLibraryNavEnabled: false,
  guestVideoNavEnabled: false,
  guestAudioNavEnabled: false,
  guestFileNavEnabled: false,
  guestTagLibraryNavEnabled: false,
  guestAdvancedTagSearchEnabled: false,
  guestHotwordLinksEnabled: false,
  videoThumbnailSinglePercent: 33,
  relatedVideoCount: 5,
  relatedVideoMode: "next",
  contentRateLimitPerMinute: 0,
  contentRateLimitWindowSeconds: 0,
  contentRateLimitRules: [],
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

function cleanColorPalette(value: unknown): ColorPalette {
  return typeof value === "string" && isColorPalette(value) ? value : "default";
}

function cleanSiteIconMimeType(value: unknown): SiteIconMimeType {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/x-icon" ? value : "";
}

function cleanRelatedVideoMode(value: unknown): RelatedVideoMode {
  return value === "random" ? "random" : "next";
}

function cleanAudioPlaybackMode(value: unknown): AudioPlaybackMode {
  return value === "stop" || value === "repeat-one" ? value : "next";
}

function cleanBrandLinkTarget(value: unknown): BrandLinkTarget {
  return value === "home" ? "home" : "novels";
}

function cleanCatalogPromotionOrder(value: unknown): CatalogPromotionOrder {
  return value === "random-first" ? "random-first" : "manual-first";
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanStringList(value: unknown, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )).slice(0, limit);
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

function writeSettingsFile(settingsPath: string, settings: object) {
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

function removeLegacySettings(value: Record<string, unknown>): { settings: Partial<SiteSettings>; changed: boolean } {
  const settings = { ...value };
  let changed = false;
  for (const key of LEGACY_SETTING_KEYS) {
    if (Object.hasOwn(settings, key)) {
      delete settings[key];
      changed = true;
    }
  }
  return { settings: settings as Partial<SiteSettings>, changed };
}

function readSiteSettingsFromDisk(): SiteSettings {
  const settingsPath = getSiteSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const cleaned = removeLegacySettings(raw);
    const parsed = cleaned.settings;
    if (cleaned.changed) {
      try {
        writeSettingsFile(settingsPath, parsed);
      } catch (error) {
        console.error("Failed to remove legacy settings", error);
      }
    }
    return {
      siteName: cleanText(parsed.siteName),
      siteTitle: cleanText(parsed.siteTitle),
      brandLinkTarget: cleanBrandLinkTarget(parsed.brandLinkTarget),
      settingsPreviewText:
        typeof parsed.settingsPreviewText === "string"
          ? cleanText(parsed.settingsPreviewText)
          : DEFAULT_SETTINGS.settingsPreviewText,
      siteIconFileName: path.basename(cleanText(parsed.siteIconFileName)),
      siteIconMimeType: cleanSiteIconMimeType(parsed.siteIconMimeType),
      siteIconUpdatedAt: cleanText(parsed.siteIconUpdatedAt),
      readerDefaultFontSize: cleanInt(parsed.readerDefaultFontSize, DEFAULT_SETTINGS.readerDefaultFontSize, 8, 25),
      readerDefaultLineHeight: normalizeReaderLineHeight(
        typeof parsed.readerDefaultLineHeight === "number" || typeof parsed.readerDefaultLineHeight === "string"
          ? parsed.readerDefaultLineHeight
          : undefined,
        DEFAULT_SETTINGS.readerDefaultLineHeight,
      ),
      readerDefaultTagsMode: normalizeReaderTagsMode(
        typeof parsed.readerDefaultTagsMode === "string" ? parsed.readerDefaultTagsMode : undefined,
        DEFAULT_SETTINGS.readerDefaultTagsMode,
      ),
      defaultPalette: cleanColorPalette(parsed.defaultPalette),
      defaultPaletteRandomEnabled: cleanBool(parsed.defaultPaletteRandomEnabled, DEFAULT_SETTINGS.defaultPaletteRandomEnabled),
      defaultPaletteRotationMinutes: cleanInt(
        parsed.defaultPaletteRotationMinutes,
        DEFAULT_SETTINGS.defaultPaletteRotationMinutes,
        1,
        10_080,
      ),
      adminUsername: cleanText(parsed.adminUsername),
      adminPasswordHash: cleanText(parsed.adminPasswordHash),
      adminPasswordSha256: cleanText(parsed.adminPasswordSha256),
      adminLoginRecords: cleanLoginRecords(parsed.adminLoginRecords),
      adminLoginRateLimitPerMinute: cleanInt(parsed.adminLoginRateLimitPerMinute, DEFAULT_SETTINGS.adminLoginRateLimitPerMinute, 0, 120),
      adminLoginRateLimitEnabled: cleanBool(parsed.adminLoginRateLimitEnabled, DEFAULT_SETTINGS.adminLoginRateLimitEnabled),
      adminIpAllowlistEnabled: cleanBool(parsed.adminIpAllowlistEnabled, DEFAULT_SETTINGS.adminIpAllowlistEnabled),
      adminAllowedNetworks: cleanStringList(parsed.adminAllowedNetworks),
      adminTheme: cleanTheme(parsed.adminTheme),
      catalogPageSize: cleanInt(parsed.catalogPageSize, DEFAULT_SETTINGS.catalogPageSize, 0, 100),
      searchResultsPageSize: cleanInt(parsed.searchResultsPageSize, DEFAULT_SETTINGS.searchResultsPageSize, 0, 100),
      adminBookPageSize: cleanInt(parsed.adminBookPageSize, DEFAULT_SETTINGS.adminBookPageSize, 0, 200),
      randomCatalogEnabled: cleanBool(parsed.randomCatalogEnabled, DEFAULT_SETTINGS.randomCatalogEnabled),
      manualPinnedNovelsEnabled: cleanBool(parsed.manualPinnedNovelsEnabled, DEFAULT_SETTINGS.manualPinnedNovelsEnabled),
      randomRecommendationsEnabled: cleanBool(parsed.randomRecommendationsEnabled, DEFAULT_SETTINGS.randomRecommendationsEnabled),
      catalogPromotionOrder: cleanCatalogPromotionOrder(parsed.catalogPromotionOrder),
      randomRecommendationCount: cleanInt(
        parsed.randomRecommendationCount,
        DEFAULT_SETTINGS.randomRecommendationCount,
        1,
        50,
      ),
      randomRecommendationIntervalMinutes: cleanInt(
        parsed.randomRecommendationIntervalMinutes,
        DEFAULT_SETTINGS.randomRecommendationIntervalMinutes,
        1,
        10_080,
      ),
      noticeDisplaySeconds: cleanInt(parsed.noticeDisplaySeconds, DEFAULT_SETTINGS.noticeDisplaySeconds, 0, 60),
      audioDefaultPlaybackMode: cleanAudioPlaybackMode(parsed.audioDefaultPlaybackMode),
      showProgressBars: cleanBool(parsed.showProgressBars, DEFAULT_SETTINGS.showProgressBars),
      frontendSearchConcurrencyLimit: cleanInt(parsed.frontendSearchConcurrencyLimit, DEFAULT_SETTINGS.frontendSearchConcurrencyLimit, 0, 100),
      globalSearchMaxResults: cleanInt(parsed.globalSearchMaxResults, DEFAULT_SETTINGS.globalSearchMaxResults, 0, 1000),
      userLoginEnabled: cleanBool(parsed.userLoginEnabled, DEFAULT_SETTINGS.userLoginEnabled),
      userRegistrationEnabled: cleanBool(parsed.userRegistrationEnabled, DEFAULT_SETTINGS.userRegistrationEnabled),
      userDailyRegistrationLimitPerIp: cleanInt(
        parsed.userDailyRegistrationLimitPerIp,
        DEFAULT_SETTINGS.userDailyRegistrationLimitPerIp,
        0,
        100,
      ),
      userDailyReportLimit: cleanInt(parsed.userDailyReportLimit, DEFAULT_SETTINGS.userDailyReportLimit, 1, 500),
      userAvatarMaxBytes: cleanInt(parsed.userAvatarMaxBytes, DEFAULT_SETTINGS.userAvatarMaxBytes, 0, 10 * 1024 ** 2),
      stationDisplayName: cleanText(parsed.stationDisplayName).slice(0, 20) || DEFAULT_SETTINGS.stationDisplayName,
      announcementCardEnabled: cleanBool(parsed.announcementCardEnabled, DEFAULT_SETTINGS.announcementCardEnabled),
      guestAnnouncementCardEnabled: cleanBool(
        parsed.guestAnnouncementCardEnabled,
        DEFAULT_SETTINGS.guestAnnouncementCardEnabled,
      ),
      announcementCardTarget: parsed.announcementCardTarget === "latest" ? "latest" : "list",
      homePortalOrder: normalizeHomePortalOrder(parsed.homePortalOrder),
      publicDisplayHomeCards: normalizePublicDisplayHomeCards(parsed.publicDisplayHomeCards),
      analyticsEnabled: cleanBool(parsed.analyticsEnabled, DEFAULT_SETTINGS.analyticsEnabled),
      analyticsRealtimeLimit: cleanInt(parsed.analyticsRealtimeLimit, DEFAULT_SETTINGS.analyticsRealtimeLimit, 0, 2000),
      novelLibraryEnabled: cleanBool(parsed.novelLibraryEnabled, DEFAULT_SETTINGS.novelLibraryEnabled),
      videoLibraryEnabled: cleanBool(parsed.videoLibraryEnabled, DEFAULT_SETTINGS.videoLibraryEnabled),
      audioLibraryEnabled: cleanBool(parsed.audioLibraryEnabled, DEFAULT_SETTINGS.audioLibraryEnabled),
      fileLibraryEnabled: cleanBool(parsed.fileLibraryEnabled, DEFAULT_SETTINGS.fileLibraryEnabled),
      tagLibraryEnabled: cleanBool(parsed.tagLibraryEnabled, DEFAULT_SETTINGS.tagLibraryEnabled),
      advancedTagSearchEnabled: cleanBool(parsed.advancedTagSearchEnabled, DEFAULT_SETTINGS.advancedTagSearchEnabled),
      hotwordLinksEnabled: cleanBool(parsed.hotwordLinksEnabled, DEFAULT_SETTINGS.hotwordLinksEnabled),
      guestLibraryNavEnabled: cleanBool(parsed.guestLibraryNavEnabled, DEFAULT_SETTINGS.guestLibraryNavEnabled),
      guestVideoNavEnabled: cleanBool(parsed.guestVideoNavEnabled, DEFAULT_SETTINGS.guestVideoNavEnabled),
      guestAudioNavEnabled: cleanBool(parsed.guestAudioNavEnabled, DEFAULT_SETTINGS.guestAudioNavEnabled),
      guestFileNavEnabled: cleanBool(parsed.guestFileNavEnabled, DEFAULT_SETTINGS.guestFileNavEnabled),
      guestTagLibraryNavEnabled: cleanBool(parsed.guestTagLibraryNavEnabled, DEFAULT_SETTINGS.guestTagLibraryNavEnabled),
      guestAdvancedTagSearchEnabled: cleanBool(parsed.guestAdvancedTagSearchEnabled, DEFAULT_SETTINGS.guestAdvancedTagSearchEnabled),
      guestHotwordLinksEnabled: cleanBool(parsed.guestHotwordLinksEnabled, DEFAULT_SETTINGS.guestHotwordLinksEnabled),
      videoThumbnailSinglePercent: cleanInt(parsed.videoThumbnailSinglePercent, DEFAULT_SETTINGS.videoThumbnailSinglePercent, 1, 99),
      relatedVideoCount: cleanInt(parsed.relatedVideoCount, DEFAULT_SETTINGS.relatedVideoCount, 0, 20),
      relatedVideoMode: cleanRelatedVideoMode(parsed.relatedVideoMode),
      contentRateLimitPerMinute: cleanInt(parsed.contentRateLimitPerMinute, DEFAULT_SETTINGS.contentRateLimitPerMinute, 0, 600),
      contentRateLimitWindowSeconds: cleanInt(parsed.contentRateLimitWindowSeconds, DEFAULT_SETTINGS.contentRateLimitWindowSeconds, 0, 3600),
      contentRateLimitRules: normalizeIpRateLimitRules(parsed.contentRateLimitRules),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function readSiteSettings(): SiteSettings {
  const settingsPath = getSiteSettingsPath();
  const state = globalThis as SiteSettingsGlobal;
  let mtimeMs = 0;
  let size = 0;
  try {
    const stat = fs.statSync(settingsPath);
    mtimeMs = stat.mtimeMs;
    size = stat.size;
  } catch {
    // Missing settings use defaults and are cached below.
  }
  if (
    state.siteSettingsCache?.schemaVersion === SITE_SETTINGS_CACHE_SCHEMA_VERSION &&
    state.siteSettingsCache?.path === settingsPath &&
    state.siteSettingsCache.mtimeMs === mtimeMs &&
    state.siteSettingsCache.size === size
  ) {
    return state.siteSettingsCache.value;
  }

  const value = readSiteSettingsFromDisk();
  state.siteSettingsCache = {
    schemaVersion: SITE_SETTINGS_CACHE_SCHEMA_VERSION,
    path: settingsPath,
    mtimeMs,
    size,
    value,
  };
  return value;
}

export function writeSiteSettings(settings: SiteSettings) {
  const settingsPath = getSiteSettingsPath();
  writeSettingsFile(settingsPath, settings);
  delete (globalThis as SiteSettingsGlobal).siteSettingsCache;
}
