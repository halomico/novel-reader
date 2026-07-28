export const PUBLIC_PAGE_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300, stale-if-error=86400";
export const PUBLIC_READER_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=300, stale-if-error=86400";
export const PRIVATE_DOCUMENT_CACHE_CONTROL = "private, max-age=0, must-revalidate";

export type PublicPageCacheRequest = {
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
  accept: string | null;
  hasUserSession: boolean;
  isRscRequest: boolean;
  isRouterPrefetch: boolean;
  allowPublicNovelPages: boolean;
};

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
  if (pathname === "/novels" || /^\/tags\/[^/]+$/.test(pathname)) {
    return hasOnlyPositivePage(searchParams);
  }
  if (allowPublicNovelPages && /^\/books\/[1-9]\d*$/.test(pathname)) {
    return hasSafeReaderReturnPath(searchParams);
  }
  return pathname === "/tags" && searchParams.size === 0;
}

export function isPublicPageCacheCandidate(request: PublicPageCacheRequest): boolean {
  if (
    request.method !== "GET" ||
    request.hasUserSession ||
    request.isRscRequest ||
    request.isRouterPrefetch ||
    request.searchParams.has("_rsc")
  ) {
    return false;
  }

  if (request.accept && request.accept !== "*/*" && !request.accept.includes("text/html")) {
    return false;
  }

  return isCacheablePublicPath(
    request.pathname,
    request.searchParams,
    request.allowPublicNovelPages,
  );
}
