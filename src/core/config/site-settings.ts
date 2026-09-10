import { cache } from "react";
import { PostgresSettingsRepository, SITE_SETTINGS_KEY } from "./postgres-settings";
import { defaultSiteSettings, normalizeSiteSettings, type SiteSettings } from "./site-settings-schema";

const repository = new PostgresSettingsRepository<SiteSettings>({ parse: normalizeSiteSettings });

/** React memoizes only within the current server render. No permission settings
 * are shared between requests without checking the PostgreSQL source of truth. */
export const readPostgresSiteSettingsSnapshot = cache(async () => {
  const snapshot = await repository.read(SITE_SETTINGS_KEY);
  if (!snapshot) throw new Error("PostgreSQL site settings are not initialized; run db:pg:init");
  return snapshot;
});

export async function readFreshPostgresSiteSettingsSnapshot() {
  const snapshot = await repository.read(SITE_SETTINGS_KEY, { fresh: true });
  if (!snapshot) throw new Error("PostgreSQL site settings are not initialized; run db:pg:init");
  return snapshot;
}

export async function readPostgresSiteSettings(): Promise<SiteSettings> {
  return (await readPostgresSiteSettingsSnapshot()).value;
}

export async function writePostgresSiteSettings(settings: SiteSettings, expectedVersion: number) {
  return repository.compareAndSet(SITE_SETTINGS_KEY, expectedVersion, settings);
}

export { defaultSiteSettings };
