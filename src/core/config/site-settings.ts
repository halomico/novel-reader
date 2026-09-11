import { cache } from "react";
import { PostgresSettingsRepository, SITE_SETTINGS_KEY } from "./postgres-settings";
import { defaultSiteSettings, normalizeSiteSettings, type SiteSettings } from "./site-settings-schema";

/** Settings are shared across requests for at most two seconds, the same bound as
 * the runtime settings refresher. Writes through this repository invalidate the
 * local cache immediately; other instances converge within the bound. Admin
 * compare-and-set flows keep using the fresh read below. */
const SITE_SETTINGS_CACHE_MAX_AGE_MS = 2_000;
const repository = new PostgresSettingsRepository<SiteSettings>(
  { parse: normalizeSiteSettings },
  undefined,
  { cacheMaxAgeMs: SITE_SETTINGS_CACHE_MAX_AGE_MS },
);

/** React additionally memoizes the snapshot within one server render. */
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
