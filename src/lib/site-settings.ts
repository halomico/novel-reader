import fs from "node:fs";
import path from "node:path";

export type AdminTheme = "system" | "light" | "dark";

export type SiteSettings = {
  siteName: string;
  siteTitle: string;
  settingsPreviewText: string;
  adminAllowedIps: string;
  adminBlockedIps: string;
  adminOutboundAllowedIps: string;
  adminOutboundBlockedIps: string;
  adminRateLimitPerMinute: number;
  adminLoginRateLimitPerMinute: number;
  adminTheme: AdminTheme;
};

const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "",
  siteTitle: "",
  settingsPreviewText: "",
  adminAllowedIps: "",
  adminBlockedIps: "",
  adminOutboundAllowedIps: "",
  adminOutboundBlockedIps: "",
  adminRateLimitPerMinute: 0,
  adminLoginRateLimitPerMinute: 0,
  adminTheme: "system",
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
      adminAllowedIps: cleanText(parsed.adminAllowedIps),
      adminBlockedIps: cleanText(parsed.adminBlockedIps),
      adminOutboundAllowedIps: cleanText(parsed.adminOutboundAllowedIps),
      adminOutboundBlockedIps: cleanText(parsed.adminOutboundBlockedIps),
      adminRateLimitPerMinute: cleanInt(parsed.adminRateLimitPerMinute, DEFAULT_SETTINGS.adminRateLimitPerMinute, 0, 600),
      adminLoginRateLimitPerMinute: cleanInt(parsed.adminLoginRateLimitPerMinute, DEFAULT_SETTINGS.adminLoginRateLimitPerMinute, 0, 120),
      adminTheme: cleanTheme(parsed.adminTheme),
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
