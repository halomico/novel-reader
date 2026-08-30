import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_HOME_PORTAL_ACCESS_MODES,
  DEFAULT_HOME_PORTAL_ORDER,
  normalizeHomePortalAccessModes,
  normalizeHomePortalOrder,
  resolveHomePortalAccessMode,
  type HomePortalAccessModes,
  type HomePortalCardKey,
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
export type UserRegistrationMode = "closed" | "invite" | "open";
export type NovelSourceSearchMode = "full" | "book";
export type ReaderAdjacentNovelSort = "updated" | "name";

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
  defaultNovelLibrarySlug: string;
  siteEntryNoticeEnabled: boolean;
  siteEntryNoticeTitle: string;
  siteEntryNoticeMarkdown: string;
  siteEntryNoticeVersion: string;
  siteIconFileName: string;
  siteIconMimeType: SiteIconMimeType;
  siteIconUpdatedAt: string;
  readerDefaultFontSize: number;
  readerDefaultLineHeight: ReaderLineHeight;
  readerDefaultTagsMode: ReaderTagsMode;
  readerAdjacentNovelSort: ReaderAdjacentNovelSort;
  novelCatalogSearchExpanded: boolean;
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
  novelSourceSearchModes: Record<string, NovelSourceSearchMode>;
  userLoginEnabled: boolean;
  userRegistrationEnabled: boolean;
  userRegistrationMode: UserRegistrationMode;
  emailVerificationRequired: boolean;
  marketEnabled: boolean;
  cookieToSodaRate: number;
  bidirectionalCurrencyExchangeEnabled: boolean;
  userDailyRegistrationLimitPerIp: number;
  userDailyReportLimit: number;
  userAvatarMaxBytes: number;
  stationDisplayName: string;
  announcementCardTarget: AnnouncementCardTarget;
  homePortalOrder: HomePortalCardKey[];
  homePortalAccessModes: HomePortalAccessModes;
  analyticsEnabled: boolean;
  analyticsRealtimeLimit: number;
  advancedTagSearchEnabled: boolean;
  hotwordLinksEnabled: boolean;
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

const SITE_SETTINGS_CACHE_SCHEMA_VERSION = 16;

const DEFAULT_SETTINGS_PREVIEW_TEXT =
  process.env.SETTINGS_PREVIEW_TEXT?.trim() ||
  "Example preview text for local development.";

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
  defaultNovelLibrarySlug: "default",
  siteEntryNoticeEnabled: false,
  siteEntryNoticeTitle: "重要通知",
  siteEntryNoticeMarkdown: "",
  siteEntryNoticeVersion: "",
  siteIconFileName: "",
  siteIconMimeType: "",
  siteIconUpdatedAt: "",
  readerDefaultFontSize: 18,
  readerDefaultLineHeight: 1.7,
  readerDefaultTagsMode: "collapsed",
  readerAdjacentNovelSort: "updated",
  novelCatalogSearchExpanded: true,
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
  novelSourceSearchModes: {},
  userLoginEnabled: true,
  userRegistrationEnabled: true,
  userRegistrationMode: "open",
  emailVerificationRequired: false,
  marketEnabled: true,
  cookieToSodaRate: 10,
  bidirectionalCurrencyExchangeEnabled: false,
  userDailyRegistrationLimitPerIp: 0,
  userDailyReportLimit: 50,
  userAvatarMaxBytes: 0,
  stationDisplayName: "站务",
  announcementCardTarget: "list",
  homePortalOrder: DEFAULT_HOME_PORTAL_ORDER,
  homePortalAccessModes: DEFAULT_HOME_PORTAL_ACCESS_MODES,
  analyticsEnabled: false,
  analyticsRealtimeLimit: 0,
  advancedTagSearchEnabled: false,
  hotwordLinksEnabled: true,
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

function cleanUserRegistrationMode(value: unknown, legacyEnabled: boolean): UserRegistrationMode {
  if (value === "closed" || value === "invite" || value === "open") {
    return value;
  }
  return legacyEnabled ? "open" : "closed";
}

function cleanBrandLinkTarget(value: unknown): BrandLinkTarget {
  return value === "home" ? "home" : "novels";
}

function cleanDefaultNovelLibrarySlug(value: unknown): string {
  const slug = cleanText(value).normalize("NFKC").toLocaleLowerCase("en-US").slice(0, 64);
  return slug === "all" || /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) ? slug : "default";
}

function cleanCatalogPromotionOrder(value: unknown): CatalogPromotionOrder {
  return value === "random-first" ? "random-first" : "manual-first";
}

function cleanBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeNovelSourceSearchModes(value: unknown): Record<string, NovelSourceSearchMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const modes: Record<string, NovelSourceSearchMode> = {};
  for (const [rawSlug, rawMode] of Object.entries(value).slice(0, 200)) {
    const slug = rawSlug.normalize("NFKC").trim().toLocaleLowerCase("en-US").slice(0, 64);
    if (slug && rawMode === "book") {
      modes[slug] = "book";
    }
  }
  return modes;
}

function legacyHomePortalAccessModes(value: Record<string, unknown>): HomePortalAccessModes {
  const displayed = new Set(Array.isArray(value.publicDisplayHomeCards) ? value.publicDisplayHomeCards : []);
  const mode = (key: string, enabledKey: string, guestKey: string) => resolveHomePortalAccessMode(
    cleanBool(value[enabledKey], true),
    cleanBool(value[guestKey], key === "announcement"),
    displayed.has(key),
  );
  return {
    announcement: mode("announcement", "announcementCardEnabled", "guestAnnouncementCardEnabled"),
    novels: mode("novels", "novelLibraryEnabled", "guestLibraryNavEnabled"),
    tags: mode("tags", "tagLibraryEnabled", "guestTagLibraryNavEnabled"),
    video: mode("video", "videoLibraryEnabled", "guestVideoNavEnabled"),
    audio: mode("audio", "audioLibraryEnabled", "guestAudioNavEnabled"),
    file: mode("file", "fileLibraryEnabled", "guestFileNavEnabled"),
  };
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
      defaultNovelLibrarySlug: cleanDefaultNovelLibrarySlug(parsed.defaultNovelLibrarySlug),
      siteEntryNoticeEnabled: cleanBool(
        parsed.siteEntryNoticeEnabled,
        DEFAULT_SETTINGS.siteEntryNoticeEnabled,
      ),
      siteEntryNoticeTitle:
        cleanText(parsed.siteEntryNoticeTitle).slice(0, 80) || DEFAULT_SETTINGS.siteEntryNoticeTitle,
      siteEntryNoticeMarkdown: cleanText(parsed.siteEntryNoticeMarkdown).slice(0, 20_000),
      siteEntryNoticeVersion: cleanText(parsed.siteEntryNoticeVersion).slice(0, 80),
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
      readerAdjacentNovelSort: parsed.readerAdjacentNovelSort === "name" ? "name" : "updated",
      novelCatalogSearchExpanded: cleanBool(
        parsed.novelCatalogSearchExpanded,
        DEFAULT_SETTINGS.novelCatalogSearchExpanded,
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
        1000,
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
      novelSourceSearchModes: normalizeNovelSourceSearchModes(parsed.novelSourceSearchModes),
      userLoginEnabled: cleanBool(parsed.userLoginEnabled, DEFAULT_SETTINGS.userLoginEnabled),
      userRegistrationEnabled: cleanBool(parsed.userRegistrationEnabled, DEFAULT_SETTINGS.userRegistrationEnabled),
      userRegistrationMode: cleanUserRegistrationMode(
        parsed.userRegistrationMode,
        cleanBool(parsed.userRegistrationEnabled, DEFAULT_SETTINGS.userRegistrationEnabled),
      ),
      emailVerificationRequired: cleanBool(
        parsed.emailVerificationRequired,
        DEFAULT_SETTINGS.emailVerificationRequired,
      ),
      marketEnabled: cleanBool(parsed.marketEnabled, DEFAULT_SETTINGS.marketEnabled),
      cookieToSodaRate: cleanInt(parsed.cookieToSodaRate, DEFAULT_SETTINGS.cookieToSodaRate, 1, 10_000),
      bidirectionalCurrencyExchangeEnabled: cleanBool(
        parsed.bidirectionalCurrencyExchangeEnabled,
        DEFAULT_SETTINGS.bidirectionalCurrencyExchangeEnabled,
      ),
      userDailyRegistrationLimitPerIp: cleanInt(
        parsed.userDailyRegistrationLimitPerIp,
        DEFAULT_SETTINGS.userDailyRegistrationLimitPerIp,
        0,
        100,
      ),
      userDailyReportLimit: cleanInt(parsed.userDailyReportLimit, DEFAULT_SETTINGS.userDailyReportLimit, 1, 500),
      userAvatarMaxBytes: cleanInt(parsed.userAvatarMaxBytes, DEFAULT_SETTINGS.userAvatarMaxBytes, 0, 10 * 1024 ** 2),
      stationDisplayName: cleanText(parsed.stationDisplayName).slice(0, 20) || DEFAULT_SETTINGS.stationDisplayName,
      announcementCardTarget: parsed.announcementCardTarget === "latest" ? "latest" : "list",
      homePortalOrder: normalizeHomePortalOrder(parsed.homePortalOrder),
      homePortalAccessModes: normalizeHomePortalAccessModes(
        parsed.homePortalAccessModes,
        legacyHomePortalAccessModes(parsed as Record<string, unknown>),
      ),
      analyticsEnabled: cleanBool(parsed.analyticsEnabled, DEFAULT_SETTINGS.analyticsEnabled),
      analyticsRealtimeLimit: cleanInt(parsed.analyticsRealtimeLimit, DEFAULT_SETTINGS.analyticsRealtimeLimit, 0, 10_000),
      advancedTagSearchEnabled: cleanBool(parsed.advancedTagSearchEnabled, DEFAULT_SETTINGS.advancedTagSearchEnabled),
      hotwordLinksEnabled: cleanBool(parsed.hotwordLinksEnabled, DEFAULT_SETTINGS.hotwordLinksEnabled),
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
