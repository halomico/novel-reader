import path from "node:path";

function resolveFromProject(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

export function getLibraryDir(): string {
  return resolveFromProject(process.env.NOVEL_LIBRARY_DIR || "./library/books");
}

export function getDatabasePath(): string {
  return resolveFromProject(process.env.DATABASE_PATH || "./data/novels.db");
}

export function getSiteName(): string {
  return process.env.SITE_NAME || "墨卷";
}

export function getSiteTitle(): string {
  return process.env.SITE_TITLE || getSiteName();
}

export function getSettingsPreviewText(): string {
  return (
    process.env.SETTINGS_PREVIEW_TEXT ||
    "夜色像一页慢慢翻开的纸，灯下的字迹温润清晰。读到安静处，页面不抢戏，只把故事稳稳托住。"
  );
}

function readIntConfig(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function getGlobalSearchMaxResults(): number {
  return readIntConfig("GLOBAL_SEARCH_MAX_RESULTS", 200, 1, 1000);
}

export function getSearchResultsPageSize(): number {
  return readIntConfig("SEARCH_RESULTS_PAGE_SIZE", 15, 1, 50);
}

export function getSearchRateLimitPerMinute(): number {
  return readIntConfig("SEARCH_RATE_LIMIT_PER_MINUTE", 8, 1, 120);
}

export function getSearchShortQueryRateLimitPerMinute(): number {
  return readIntConfig("SEARCH_SHORT_QUERY_RATE_LIMIT_PER_MINUTE", 3, 1, 120);
}

export function getConfiguredPaths() {
  return {
    libraryDir: getLibraryDir(),
    databasePath: getDatabasePath(),
  };
}
