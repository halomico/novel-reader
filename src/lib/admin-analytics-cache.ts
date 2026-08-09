import {
  getAnalyticsRealtimeCountries,
  getAnalyticsSummaryOverview,
  type AnalyticsOverviewOptions,
  type AnalyticsSummaryOverview,
} from "./analytics";
import { getDatabasePath } from "./config";
import { getReadingAnalytics, type ReadingAnalytics } from "./reading-progress";

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type AdminAnalyticsCacheGlobal = typeof globalThis & {
  novelReaderAdminAnalyticsCache?: {
    summaries: Map<string, CacheEntry<AnalyticsSummaryOverview>>;
    realtimeCountries: Map<string, CacheEntry<string[]>>;
    reading: Map<string, CacheEntry<ReadingAnalytics>>;
  };
};

type AnalyticsSummaryOptions = Pick<
  AnalyticsOverviewOptions,
  | "searchQueryPage"
  | "searchQueryPageSize"
  | "contentPage"
  | "contentPageSize"
  | "tagPage"
  | "tagPageSize"
  | "customFrom"
  | "customTo"
>;

export const ADMIN_ANALYTICS_CACHE_TTL_MS = 15_000;
const ADMIN_ANALYTICS_SUMMARY_CACHE_MAX_ENTRIES = 32;
const ADMIN_REALTIME_COUNTRY_CACHE_MAX_ENTRIES = 16;
const ADMIN_READING_CACHE_MAX_ENTRIES = 8;

function getCache() {
  const state = globalThis as AdminAnalyticsCacheGlobal;
  if (!state.novelReaderAdminAnalyticsCache) {
    state.novelReaderAdminAnalyticsCache = {
      summaries: new Map(),
      realtimeCountries: new Map(),
      reading: new Map(),
    };
  }
  return state.novelReaderAdminAnalyticsCache;
}

function getFreshEntry<T>(entries: Map<string, CacheEntry<T>>, key: string, now: number): T | null {
  const entry = entries.get(key);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= now) {
    entries.delete(key);
    return null;
  }
  entries.delete(key);
  entries.set(key, entry);
  return entry.value;
}

function setEntry<T>(
  entries: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  maxEntries: number,
  now: number,
) {
  entries.delete(key);
  entries.set(key, { expiresAt: now + ADMIN_ANALYTICS_CACHE_TTL_MS, value });
  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    entries.delete(oldestKey);
  }
}

export function getCachedAdminAnalyticsSummary(
  rangeValue: string | undefined,
  options: AnalyticsSummaryOptions = {},
  now = Date.now(),
): AnalyticsSummaryOverview {
  const entries = getCache().summaries;
  const key = JSON.stringify([
    getDatabasePath(),
    rangeValue || "24h",
    options.customFrom || "",
    options.customTo || "",
    options.searchQueryPage || 1,
    options.searchQueryPageSize || 100,
    options.contentPage || 1,
    options.contentPageSize || 50,
    options.tagPage || 1,
    options.tagPageSize || 50,
  ]);
  const cached = getFreshEntry(entries, key, now);
  if (cached) {
    return cached;
  }
  const value = getAnalyticsSummaryOverview(rangeValue, options);
  setEntry(entries, key, value, ADMIN_ANALYTICS_SUMMARY_CACHE_MAX_ENTRIES, now);
  return value;
}

export function getCachedAdminReadingAnalytics(
  days = 30,
  limit = 10,
  now = Date.now(),
): ReadingAnalytics {
  const entries = getCache().reading;
  const key = JSON.stringify([getDatabasePath(), days, limit]);
  const cached = getFreshEntry(entries, key, now);
  if (cached) {
    return cached;
  }
  const value = getReadingAnalytics(days, limit);
  setEntry(entries, key, value, ADMIN_READING_CACHE_MAX_ENTRIES, now);
  return value;
}

export function getCachedAdminRealtimeCountries(
  rangeValue: string | undefined,
  options: Pick<
    AnalyticsOverviewOptions,
    "realtimeContentType" | "customFrom" | "customTo"
  > = {},
  now = Date.now(),
): string[] {
  const entries = getCache().realtimeCountries;
  const key = JSON.stringify([
    getDatabasePath(),
    rangeValue || "24h",
    options.customFrom || "",
    options.customTo || "",
    options.realtimeContentType || "all",
  ]);
  const cached = getFreshEntry(entries, key, now);
  if (cached) {
    return cached;
  }
  const value = getAnalyticsRealtimeCountries(rangeValue, options);
  setEntry(entries, key, value, ADMIN_REALTIME_COUNTRY_CACHE_MAX_ENTRIES, now);
  return value;
}
