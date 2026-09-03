import path from "node:path";
import { cache } from "react";
import {
  canBrowseHomePortal,
  canConsumeHomePortal,
  isHomePortalEntryVisible,
  type HomePortalAccessMode,
  type HomePortalCardKey,
  type HomePortalContentCardKey,
} from "./home-portal";
import {
  readSiteSettings as readSiteSettingsFromDisk,
  type AudioPlaybackMode,
  type IpRateLimitRule,
  type ReaderAdjacentNovelSort,
  type RelatedVideoMode,
  type UserRegistrationMode,
} from "./site-settings";

const readSiteSettings = cache(readSiteSettingsFromDisk);

function resolveFromProject(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getLibraryDir(): string {
  return resolveFromProject(process.env.NOVEL_LIBRARY_DIR || "./library/books");
}

export function getDatabasePath(): string {
  return resolveFromProject(process.env.DATABASE_PATH || "./data/novels.db");
}

export function getContentSearchIndexDirectory(): string {
  const configured = process.env.CONTENT_SEARCH_INDEX_DIR?.trim();
  return resolveFromProject(configured || "./data/content-search");
}

export function getMediaDir(): string {
  return resolveFromProject(process.env.MEDIA_DIR || "./data/media");
}

export function isMediaLibraryDiscoverEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.MEDIA_LIBRARY_DISCOVER || "on").trim().toLowerCase();
  return raw !== "0" && raw !== "off" && raw !== "false" && raw !== "no";
}

export function getSiteName(): string {
  return readSiteSettings().siteName || process.env.SITE_NAME || "Example Reader";
}

export function getSiteTitle(): string {
  return readSiteSettings().siteTitle || process.env.SITE_TITLE || getSiteName();
}

export function getSiteBrandHref(): "/" | "/novels" {
  return readSiteSettings().brandLinkTarget === "home" ? "/" : "/novels";
}

export function getSettingsPreviewText(): string {
  return readSiteSettings().settingsPreviewText;
}

export function getDefaultNovelLibrarySlug(): string {
  return readSiteSettings().defaultNovelLibrarySlug || "default";
}

export function getReaderDefaultFontSize(): number {
  return readSiteSettings().readerDefaultFontSize;
}

export function getReaderAdjacentNovelSort(): ReaderAdjacentNovelSort {
  return readSiteSettings().readerAdjacentNovelSort;
}

export function isNovelCatalogSearchExpandedByDefault(): boolean {
  return readSiteSettings().novelCatalogSearchExpanded;
}

function readIntConfig(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function readSettingInt(settingValue: number, envName: string, fallback: number, min: number, max: number): number {
  const configuredEnv = process.env[envName];
  if (configuredEnv !== undefined && configuredEnv.trim() !== "") {
    return readIntConfig(envName, fallback, min, max);
  }
  if (Number.isFinite(settingValue)) {
    return Math.min(Math.max(Math.floor(settingValue), min), max);
  }
  return fallback;
}

function readBoolConfig(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
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

export function isRandomCatalogEnabled(): boolean {
  return readSiteSettings().randomCatalogEnabled;
}

export function getCatalogFeatureSettings(): {
  manualPinnedEnabled: boolean;
  randomRecommendationsEnabled: boolean;
  promotionOrder: "manual-first" | "random-first";
  randomRecommendationCount: number;
  randomRecommendationIntervalMinutes: number;
} {
  const settings = readSiteSettings();
  return {
    manualPinnedEnabled: settings.manualPinnedNovelsEnabled,
    randomRecommendationsEnabled: settings.randomRecommendationsEnabled,
    promotionOrder: settings.catalogPromotionOrder,
    randomRecommendationCount: settings.randomRecommendationCount,
    randomRecommendationIntervalMinutes: settings.randomRecommendationIntervalMinutes,
  };
}

export function getNoticeDisplaySeconds(): number {
  return readSettingInt(readSiteSettings().noticeDisplaySeconds, "NOTICE_DISPLAY_SECONDS", 5, 0, 60);
}

export function getAudioDefaultPlaybackMode(): AudioPlaybackMode {
  return readSiteSettings().audioDefaultPlaybackMode;
}

export function isUserLoginEnabled(): boolean {
  return readSiteSettings().userLoginEnabled && readBoolConfig("USER_LOGIN_ENABLED", true);
}

export function isUserRegistrationEnabled(): boolean {
  return getUserRegistrationMode() !== "closed";
}

export function getUserRegistrationMode(): UserRegistrationMode {
  if (!readBoolConfig("USER_REGISTRATION_ENABLED", true)) {
    return "closed";
  }
  const configured = process.env.USER_REGISTRATION_MODE?.trim().toLocaleLowerCase("en-US");
  if (configured === "closed" || configured === "invite" || configured === "open") {
    return configured;
  }
  const settings = readSiteSettings();
  return settings.userRegistrationEnabled ? settings.userRegistrationMode : "closed";
}

export function isEmailVerificationRequired(): boolean {
  return readSiteSettings().emailVerificationRequired && readBoolConfig("EMAIL_VERIFICATION_REQUIRED", true);
}

export function isMarketEnabled(): boolean {
  return readSiteSettings().marketEnabled && readBoolConfig("MARKET_ENABLED", true);
}

export function getCookieToSodaRate(): number {
  return readSettingInt(readSiteSettings().cookieToSodaRate, "COOKIE_TO_SODA_RATE", 10, 1, 10_000);
}

export function isBidirectionalCurrencyExchangeEnabled(): boolean {
  return readSiteSettings().bidirectionalCurrencyExchangeEnabled;
}

export function isOriginalChannelEnabled(): boolean {
  const settings = readSiteSettings();
  return settings.originalChannelEnabled && settings.homePortalAccessModes.original !== "off";
}

export function canAccessOriginalChannel(authenticated: boolean): boolean {
  const settings = readSiteSettings();
  return settings.originalChannelEnabled && canBrowseHomePortal(settings.homePortalAccessModes.original, authenticated);
}

export function canConsumeOriginalChannel(authenticated: boolean): boolean {
  const settings = readSiteSettings();
  return settings.originalChannelEnabled && canConsumeHomePortal(settings.homePortalAccessModes.original, authenticated);
}

export function isOriginalChannelEntryVisible(authenticated: boolean): boolean {
  const settings = readSiteSettings();
  return settings.originalChannelEnabled && isHomePortalEntryVisible(settings.homePortalAccessModes.original, authenticated);
}

export function getOriginalPublishingSettings(): {
  minSoda: number;
  minLevel: number;
  publishFeeSoda: number;
  editFeeSoda: number;
  maxArticlePrice: number;
  freeCommentsPerLevel: number;
  commentCostSoda: number;
  articleMinWords: number;
  commentMinChars: number;
  maxTags: number;
  pageSize: number;
  publishNoticeText: string;
  publishNoticeLinkLabel: string;
  publishNoticeUrl: string;
} {
  const settings = readSiteSettings();
  return {
    minSoda: settings.originalPublishMinSoda,
    minLevel: settings.originalPublishMinLevel,
    publishFeeSoda: settings.originalPublishFeeSoda,
    editFeeSoda: settings.originalEditFeeSoda,
    maxArticlePrice: settings.originalMaxArticlePrice,
    freeCommentsPerLevel: settings.originalFreeCommentsPerLevel,
    commentCostSoda: settings.originalCommentCostSoda,
    articleMinWords: settings.originalArticleMinWords,
    commentMinChars: settings.originalCommentMinChars,
    maxTags: settings.originalMaxTags,
    pageSize: settings.originalPageSize,
    publishNoticeText: settings.originalPublishNoticeText,
    publishNoticeLinkLabel: settings.originalPublishNoticeLinkLabel,
    publishNoticeUrl: settings.originalPublishNoticeUrl,
  };
}

export function getUserDailyRegistrationLimitPerIp(): number {
  return readSettingInt(readSiteSettings().userDailyRegistrationLimitPerIp, "USER_DAILY_REGISTRATION_LIMIT_PER_IP", 2, 0, 100);
}

export function getUserDailyReportLimit(): number {
  return readSettingInt(readSiteSettings().userDailyReportLimit, "USER_DAILY_REPORT_LIMIT", 50, 1, 500);
}

export function getUserAvatarMaxBytes(): number {
  return readSettingInt(readSiteSettings().userAvatarMaxBytes, "USER_AVATAR_MAX_BYTES", 1048576, 1, 10 * 1024 ** 2);
}

export function getStationDisplayName(): string {
  return readSiteSettings().stationDisplayName || "站务";
}

export function canAccessHomeAnnouncementCard(authenticated: boolean): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode("announcement"), authenticated);
}

export function getAnnouncementCardTarget(): "list" | "latest" {
  return readSiteSettings().announcementCardTarget;
}

export function getHomePortalOrder(): HomePortalCardKey[] {
  return readSiteSettings().homePortalOrder;
}

export function getHomePortalAccessMode(key: HomePortalContentCardKey): HomePortalAccessMode {
  return readSiteSettings().homePortalAccessModes[key];
}

export function canBrowseHomePortalContent(key: HomePortalContentCardKey, authenticated: boolean): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode(key), authenticated);
}

export function canSeeHomePortalContentEntry(key: HomePortalContentCardKey, authenticated: boolean): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode(key), authenticated);
}

export function canConsumeHomePortalContent(key: HomePortalContentCardKey, authenticated: boolean): boolean {
  return canConsumeHomePortal(getHomePortalAccessMode(key), authenticated);
}

export function isAnalyticsEnabled(): boolean {
  return readSiteSettings().analyticsEnabled && readBoolConfig("ANALYTICS_ENABLED", true);
}

export function getAnalyticsRealtimeLimit(): number {
  return readSettingInt(readSiteSettings().analyticsRealtimeLimit, "ANALYTICS_REALTIME_LIMIT", 300, 30, 10_000);
}

export function isNovelLibraryEnabled(): boolean {
  return getHomePortalAccessMode("novels") !== "off";
}

export function canAccessNovelLibrary(authenticated: boolean): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode("novels"), authenticated);
}

export function canConsumeNovelLibrary(authenticated: boolean): boolean {
  return canConsumeHomePortal(getHomePortalAccessMode("novels"), authenticated);
}

export function isNovelLibraryPublic(): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode("novels"), false);
}

export function isNovelContentPublic(): boolean {
  return canConsumeHomePortal(getHomePortalAccessMode("novels"), false);
}

export function isVideoLibraryEnabled(): boolean {
  return getHomePortalAccessMode("video") !== "off";
}

export function isAudioLibraryEnabled(): boolean {
  return getHomePortalAccessMode("audio") !== "off";
}

export function isFileLibraryEnabled(): boolean {
  return getHomePortalAccessMode("file") !== "off";
}

export function isTagLibraryEnabled(): boolean {
  return getHomePortalAccessMode("tags") !== "off";
}

export function canAccessTagLibrary(authenticated: boolean): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode("tags"), authenticated);
}

export function isTagLibraryPublic(): boolean {
  return canAccessTagLibrary(false);
}

export function isAdvancedTagSearchEnabled(): boolean {
  const settings = readSiteSettings();
  return getHomePortalAccessMode("tags") !== "off" && settings.advancedTagSearchEnabled;
}

export function canAccessAdvancedTagSearch(authenticated: boolean): boolean {
  const settings = readSiteSettings();
  return canAccessNovelLibrary(authenticated) &&
    canBrowseHomePortal(getHomePortalAccessMode("tags"), authenticated) &&
    settings.advancedTagSearchEnabled &&
    (authenticated || settings.guestAdvancedTagSearchEnabled);
}

export function isAdvancedTagSearchPublic(): boolean {
  return canAccessAdvancedTagSearch(false);
}

export function areHotwordLinksEnabled(): boolean {
  return readSiteSettings().hotwordLinksEnabled;
}

export function isGuestLibraryNavEnabled(): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode("novels"), false);
}

export function isGuestVideoNavEnabled(): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode("video"), false);
}

export function isGuestAudioNavEnabled(): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode("audio"), false);
}

export function isGuestFileNavEnabled(): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode("file"), false);
}

export function isGuestTagLibraryNavEnabled(): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode("tags"), false);
}

export function areGuestHotwordLinksEnabled(): boolean {
  return readSiteSettings().guestHotwordLinksEnabled;
}

export function getVideoThumbnailSettings(): {
  singlePercent: number;
} {
  const settings = readSiteSettings();
  return {
    singlePercent: settings.videoThumbnailSinglePercent,
  };
}

export function getRelatedVideoSettings(): { count: number; mode: RelatedVideoMode } {
  const settings = readSiteSettings();
  return { count: settings.relatedVideoCount, mode: settings.relatedVideoMode };
}

export function getFrontendSearchConcurrencyLimit(): number {
  return readSettingInt(readSiteSettings().frontendSearchConcurrencyLimit, "FRONTEND_SEARCH_CONCURRENCY_LIMIT", 10, 1, 100);
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
  const hasLegacyLimit =
    settings.contentRateLimitPerMinute > 0 ||
    settings.contentRateLimitWindowSeconds > 0 ||
    process.env.CONTENT_RATE_LIMIT_PER_MINUTE !== undefined ||
    process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS !== undefined;
  if (!hasLegacyLimit) {
    return [];
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

export function getConfiguredPaths() {
  return {
    libraryDir: getLibraryDir(),
    databasePath: getDatabasePath(),
    contentSearchIndexDirectory: getContentSearchIndexDirectory(),
    adminSettingsPath: process.env.ADMIN_SETTINGS_PATH || "./data/admin-settings.json",
  };
}
