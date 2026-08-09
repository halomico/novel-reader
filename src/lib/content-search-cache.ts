import { getDb } from "./db";
import { getGlobalSearchMaxResults } from "./config";
import type { SearchResult } from "./search";
import type { ParsedSearchQuery } from "./search-query";

type CacheEntry = {
  expiresAt: number;
  bytes: number;
  results: SearchResult[];
};

type SearchCacheGlobal = typeof globalThis & {
  novelReaderSearchResultCache?: {
    entries: Map<string, CacheEntry>;
    bytes: number;
    dataVersion: number;
    mutationVersion: number;
  };
};

export const SEARCH_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_RESULT_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const SEARCH_RESULT_CACHE_MAX_ENTRY_BYTES = 2 * 1024 * 1024;
const SEARCH_RESULT_CACHE_MAX_ENTRIES = 32;

function readDataVersion(): number {
  const row = getDb().prepare("PRAGMA data_version").get() as { data_version?: number } | undefined;
  return Number(row?.data_version || 0);
}

function getCache() {
  const globalForCache = globalThis as SearchCacheGlobal;
  if (!globalForCache.novelReaderSearchResultCache) {
    globalForCache.novelReaderSearchResultCache = {
      entries: new Map(),
      bytes: 0,
      dataVersion: readDataVersion(),
      mutationVersion: 0,
    };
  }
  return globalForCache.novelReaderSearchResultCache;
}

function queryKey(query: ParsedSearchQuery, scopeKey = ""): string {
  return JSON.stringify([query.mode, query.expression, getGlobalSearchMaxResults(), scopeKey]);
}

function clearEntries() {
  const cache = getCache();
  cache.entries.clear();
  cache.bytes = 0;
}

function refreshExternalVersion() {
  const cache = getCache();
  const dataVersion = readDataVersion();
  if (cache.dataVersion !== dataVersion) {
    clearEntries();
    cache.dataVersion = dataVersion;
  }
}

function cleanupExpired() {
  const cache = getCache();
  const now = Date.now();
  for (const [key, entry] of cache.entries) {
    if (entry.expiresAt <= now) {
      cache.entries.delete(key);
      cache.bytes -= entry.bytes;
    }
  }
}

export function invalidateContentSearchResultCache() {
  const cache = getCache();
  cache.mutationVersion += 1;
  clearEntries();
  cache.dataVersion = readDataVersion();
}

export function getContentSearchCacheVersion(): string {
  refreshExternalVersion();
  cleanupExpired();
  const cache = getCache();
  return `${cache.dataVersion}:${cache.mutationVersion}`;
}

function getCacheEntry(query: ParsedSearchQuery, scopeKey = ""): CacheEntry | null {
  refreshExternalVersion();
  cleanupExpired();
  const cache = getCache();
  const key = `${cache.mutationVersion}:${queryKey(query, scopeKey)}`;
  const entry = cache.entries.get(key);
  if (!entry) {
    return null;
  }

  cache.entries.delete(key);
  cache.entries.set(key, entry);
  return entry;
}

export function hasCachedContentSearchResults(query: ParsedSearchQuery, scopeKey = ""): boolean {
  return getCacheEntry(query, scopeKey) !== null;
}

export function getCachedContentSearchResults(query: ParsedSearchQuery, scopeKey = ""): SearchResult[] | null {
  const entry = getCacheEntry(query, scopeKey);
  if (!entry) {
    return null;
  }
  return entry.results.map((result) => ({ ...result }));
}

export function setCachedContentSearchResults(
  query: ParsedSearchQuery,
  results: SearchResult[],
  expectedVersion?: string,
  scopeKey = "",
) {
  refreshExternalVersion();
  cleanupExpired();
  const cache = getCache();
  if (expectedVersion && expectedVersion !== `${cache.dataVersion}:${cache.mutationVersion}`) {
    return;
  }
  const clonedResults = results.map((result) => ({ ...result }));
  const bytes = Buffer.byteLength(JSON.stringify(clonedResults), "utf8");
  if (bytes > SEARCH_RESULT_CACHE_MAX_ENTRY_BYTES) {
    return;
  }

  const key = `${cache.mutationVersion}:${queryKey(query, scopeKey)}`;
  const previous = cache.entries.get(key);
  if (previous) {
    cache.bytes -= previous.bytes;
    cache.entries.delete(key);
  }
  cache.entries.set(key, { expiresAt: Date.now() + SEARCH_RESULT_CACHE_TTL_MS, bytes, results: clonedResults });
  cache.bytes += bytes;

  while (cache.entries.size > SEARCH_RESULT_CACHE_MAX_ENTRIES || cache.bytes > SEARCH_RESULT_CACHE_MAX_BYTES) {
    const oldestKey = cache.entries.keys().next().value as string | undefined;
    if (!oldestKey) break;
    const oldest = cache.entries.get(oldestKey);
    cache.entries.delete(oldestKey);
    cache.bytes -= oldest?.bytes || 0;
  }
}
