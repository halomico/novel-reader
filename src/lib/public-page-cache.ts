export const PUBLIC_PAGE_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400";
export const PUBLIC_READER_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=300, stale-if-error=86400";
export const PRIVATE_DOCUMENT_CACHE_CONTROL = "private, max-age=0, must-revalidate";

export type PublicPageCacheRequest = {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  accept: string | null;
  hasUserSession: boolean;
  hasBrowserLayoutPreference: boolean;
  isRscRequest: boolean;
  isRouterPrefetch: boolean;
  allowPublicNovelPages: boolean;
};

const NOVEL_READER_PATH = /^\/books\/[1-9]\d*(?:\/chapters\/[1-9]\d*)?$/;
const ORIGINAL_ARTICLE_PATH = /^\/original\/(?!(?:new|mine|tags)$)[^/]+$/;

/** Published reading pages change rarely and get the longer edge lifetime. */
export function isPublicReaderPath(pathname: string): boolean {
  return NOVEL_READER_PATH.test(pathname) || ORIGINAL_ARTICLE_PATH.test(pathname);
}

function hasOnlyPositivePage(searchParams: URLSearchParams): boolean {
  const entries = Array.from(searchParams.entries());
  return entries.length === 0 ||
    (entries.length === 1 && entries[0][0] === "page" && /^[1-9]\d*$/.test(entries[0][1]));
}

function hasSafeReaderReturnPath(searchParams: URLSearchParams): boolean {
  const entries = Array.from(searchParams.entries());
  if (entries.length === 0) return true;
  if (entries.length !== 1 || entries[0][0] !== "from") return false;
  return /^\/novels(?:\?page=[1-9]\d*)?$/.test(entries[0][1]) ||
    /^\/tags\/[^/?#]+(?:\?page=[1-9]\d*)?$/.test(entries[0][1]);
}

function isCacheablePublicPath(
  pathname: string,
  searchParams: URLSearchParams,
  allowPublicNovelPages: boolean,
): boolean {
  if (pathname === "/") {
    return searchParams.size === 0;
  }
  if (pathname === "/novels" || pathname === "/original" || /^\/tags\/[^/]+$/.test(pathname)) {
    return hasOnlyPositivePage(searchParams);
  }
  if (ORIGINAL_ARTICLE_PATH.test(pathname)) {
    // `comments`, `notice` and `resume` change what an article renders.
    return searchParams.size === 0;
  }
  if (allowPublicNovelPages && NOVEL_READER_PATH.test(pathname)) {
    return hasSafeReaderReturnPath(searchParams);
  }
  return pathname === "/tags" && searchParams.size === 0;
}

export function isPublicPageCacheCandidate(request: PublicPageCacheRequest): boolean {
  if (
    request.method !== "GET" ||
    request.hasUserSession ||
    request.hasBrowserLayoutPreference ||
    request.isRscRequest ||
    request.isRouterPrefetch ||
    request.searchParams.has("_rsc")
  ) {
    return false;
  }

  // Next.js strips its flight headers and the `_rsc` parameter before middleware
  // runs, so Accept is the reliable signal: document navigations ask for HTML,
  // router fetches and prefetches send `*/*`. Only HTML may enter the edge cache.
  if (!request.accept?.includes("text/html")) {
    return false;
  }

  return isCacheablePublicPath(
    request.pathname,
    request.searchParams,
    request.allowPublicNovelPages,
  );
}
