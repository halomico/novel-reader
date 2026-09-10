import path from "node:path";
import { readRuntimeSiteSettings } from "@/core/config/runtime-site-settings";
import {
  canBrowseHomePortal,
  canConsumeHomePortal,
  isHomePortalEntryVisible,
  type HomePortalAccessMode,
  type HomePortalContentCardKey,
} from "./home-portal";
import {
  type AudioPlaybackMode,
  type IpRateLimitRule,
  type ReaderAdjacentNovelSort,
  type RelatedVideoMode,
  type UserRegistrationMode,
} from "@/core/config/site-settings-schema";

const readSiteSettings = readRuntimeSiteSettings;

function resolveFromProject(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getLibraryDir(): string {
  return resolveFromProject(process.env.NOVEL_LIBRARY_DIR || "./library/books");
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

export function getReaderAdjacentNovelSort(): ReaderAdjacentNovelSort {
  return readSiteSettings().readerAdjacentNovelSort;
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
  if (Number.isFinite(settingValue) && settingValue >= min) {
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

export function getAdminBookPageSize(): number {
  return readSettingInt(readSiteSettings().adminBookPageSize, "ADMIN_BOOK_PAGE_SIZE", 20, 1, 200);
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
  };
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
  return readSettingInt(readSiteSettings().analyticsRealtimeLimit, "ANALYTICS_REALTIME_LIMIT", 300, 30, 100_000);
}

export function canAccessNovelLibrary(authenticated: boolean): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode("novels"), authenticated);
}

export function isNovelLibraryPublic(): boolean {
  return canBrowseHomePortal(getHomePortalAccessMode("novels"), false);
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

export function areHotwordLinksEnabled(): boolean {
  return readSiteSettings().hotwordLinksEnabled;
}

export function isGuestLibraryNavEnabled(): boolean {
  return isHomePortalEntryVisible(getHomePortalAccessMode("novels"), false);
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
    Boolean(process.env.CONTENT_RATE_LIMIT_PER_MINUTE?.trim()) ||
    Boolean(process.env.CONTENT_RATE_LIMIT_WINDOW_SECONDS?.trim());
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
