import type { SiteSettings, UserRegistrationMode } from "./site-settings-schema";

function environmentBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLocaleLowerCase("en-US");
  if (!value) return fallback;
  if (value === "1" || value === "true" || value === "yes" || value === "on") return true;
  if (value === "0" || value === "false" || value === "no" || value === "off") return false;
  return fallback;
}

function settingInteger(value: number, name: string, fallback: number, minimum: number, maximum: number): number {
  const configured = Number(process.env[name]);
  const candidate = Number.isFinite(configured) && configured !== 0 ? configured : value || fallback;
  return Math.min(Math.max(Math.floor(candidate), minimum), maximum);
}

export function accountLoginEnabled(settings: SiteSettings): boolean {
  return settings.userLoginEnabled && environmentBoolean("USER_LOGIN_ENABLED", true);
}

export function accountRegistrationMode(settings: SiteSettings): UserRegistrationMode {
  if (!environmentBoolean("USER_REGISTRATION_ENABLED", true)) return "closed";
  const configured = process.env.USER_REGISTRATION_MODE?.trim().toLocaleLowerCase("en-US");
  if (configured === "closed" || configured === "invite" || configured === "open") return configured;
  return settings.userRegistrationEnabled ? settings.userRegistrationMode : "closed";
}

export function accountEmailVerificationRequired(settings: SiteSettings): boolean {
  return settings.emailVerificationRequired && environmentBoolean("EMAIL_VERIFICATION_REQUIRED", true);
}

export function accountDailyRegistrationLimit(settings: SiteSettings): number {
  return settingInteger(settings.userDailyRegistrationLimitPerIp, "USER_DAILY_REGISTRATION_LIMIT_PER_IP", 2, 0, 100);
}

export function accountAvatarMaxBytes(settings: SiteSettings): number {
  return settingInteger(settings.userAvatarMaxBytes, "USER_AVATAR_MAX_BYTES", 1_048_576, 1, 10 * 1024 ** 2);
}
