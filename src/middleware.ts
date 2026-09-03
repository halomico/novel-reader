import type { NextRequest } from "next/server";
import { getTrustedRequestCountry } from "@/core/security/client-ip";
import { NextResponse } from "next/server";
import {
  checkContentAccess,
  hasGlobalContentAccessRules,
  hasScopedContentAccessControls,
} from "@/lib/content-access";
import { isNovelLibraryPublic } from "@/lib/config";
import {
  isPublicPageCacheCandidate,
  PRIVATE_DOCUMENT_CACHE_CONTROL,
  PUBLIC_PAGE_CACHE_CONTROL,
  PUBLIC_READER_CACHE_CONTROL,
} from "@/lib/public-page-cache";
import {
  DEFAULT_LOCALE,
  isLocaleAwarePath,
  localeFromPathname,
  LOCALE_COOKIE,
  LOCALE_REQUEST_HEADER,
  normalizeLocale,
  prefersTraditionalLanguage,
  stripLocalePath,
  TRADITIONAL_LOCALE,
  TRADITIONAL_PATH_PREFIX,
  type AppLocale,
} from "@/lib/locale";
import { getCurrentUserFromRequest, USER_SESSION_COOKIE } from "@/lib/user-auth";
import { NOVEL_CATALOG_SEARCH_COOKIE } from "@/lib/ui-preferences";
import { isPublicUmamiPathname, UMAMI_ROUTE_SCOPE_HEADER } from "@/lib/seo";

function bypassGlobalAccess(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/access-denied" ||
    pathname === "/api/health" ||
    pathname === "/api/site-icon" ||
    pathname.startsWith("/site-icon/") ||
    pathname === "/favicon.ico" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

function isDocumentNavigation(request: NextRequest): boolean {
  if (
    request.method !== "GET" ||
    request.headers.has("rsc") ||
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch" ||
    request.nextUrl.searchParams.has("_rsc")
  ) {
    return false;
  }
  const accept = request.headers.get("accept");
  return !accept || accept === "*/*" || accept.includes("text/html");
}

function isCrawler(request: NextRequest): boolean {
  return /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|headless/i.test(
    request.headers.get("user-agent") || "",
  );
}

function localeRedirect(request: NextRequest, locale: AppLocale): NextResponse | null {
  const originalPath = request.nextUrl.pathname;
  const normalizedPath = stripLocalePath(originalPath);
  if (!isLocaleAwarePath(normalizedPath) || !isDocumentNavigation(request)) {
    if (originalPath !== normalizedPath) {
      const url = request.nextUrl.clone();
      url.pathname = normalizedPath;
      return NextResponse.redirect(url, 308);
    }
    return null;
  }

  if (locale === TRADITIONAL_LOCALE && localeFromPathname(originalPath) !== TRADITIONAL_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = `${TRADITIONAL_PATH_PREFIX}${normalizedPath === "/" ? "" : normalizedPath}`;
    const response = NextResponse.redirect(url, 307);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  return null;
}

function resolveRequestedLocale(request: NextRequest): AppLocale {
  if (localeFromPathname(request.nextUrl.pathname) === TRADITIONAL_LOCALE) {
    return TRADITIONAL_LOCALE;
  }
  const explicit = request.cookies.get(LOCALE_COOKIE)?.value;
  if (explicit) {
    return normalizeLocale(explicit);
  }
  if (
    !request.cookies.has(USER_SESSION_COOKIE) &&
    isDocumentNavigation(request) &&
    !isCrawler(request) &&
    prefersTraditionalLanguage(
      request.headers.get("accept-language"),
      getTrustedRequestCountry(request.headers),
    )
  ) {
    return TRADITIONAL_LOCALE;
  }
  return DEFAULT_LOCALE;
}

function createLocaleResponse(request: NextRequest, locale: AppLocale): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(LOCALE_REQUEST_HEADER, locale);
  const normalizedPath = stripLocalePath(request.nextUrl.pathname);
  requestHeaders.set(UMAMI_ROUTE_SCOPE_HEADER, isPublicUmamiPathname(normalizedPath) ? "public" : "admin");
  if (normalizedPath !== request.nextUrl.pathname) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = normalizedPath;
    return NextResponse.rewrite(rewriteUrl, { request: { headers: requestHeaders } });
  }
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function applyDocumentCachePolicy(
  request: NextRequest,
  response: NextResponse,
  pathname = stripLocalePath(request.nextUrl.pathname),
): NextResponse {
  const hasUserSession = request.cookies.has(USER_SESSION_COOKIE);
  const usesNovelCatalogSearchPreference = pathname === "/novels" || pathname === "/novels/recent";
  const hasBrowserLayoutPreference =
    usesNovelCatalogSearchPreference && request.cookies.has(NOVEL_CATALOG_SEARCH_COOKIE);
  const isNovelPage = /^\/books\/[1-9]\d*(?:\/chapters\/[1-9]\d*)?$/.test(pathname);
  const cacheable = isPublicPageCacheCandidate({
    method: request.method,
    pathname,
    searchParams: request.nextUrl.searchParams,
    accept: request.headers.get("accept"),
    hasUserSession,
    hasBrowserLayoutPreference,
    isRscRequest: request.headers.has("rsc"),
    isRouterPrefetch:
      request.headers.has("next-router-prefetch") ||
      request.headers.get("purpose") === "prefetch",
    allowPublicNovelPages:
      isNovelPage &&
      isNovelLibraryPublic() &&
      !hasScopedContentAccessControls("novel"),
  });

  if (cacheable) {
    const cdnCacheControl = isNovelPage
      ? PUBLIC_READER_CACHE_CONTROL
      : PUBLIC_PAGE_CACHE_CONTROL;
    response.headers.set("Cache-Control", PRIVATE_DOCUMENT_CACHE_CONTROL);
    response.headers.set("CDN-Cache-Control", cdnCacheControl);
    response.headers.set("Cloudflare-CDN-Cache-Control", cdnCacheControl);
    response.headers.set("X-Public-Cache", "guest");
  } else if (hasUserSession || hasBrowserLayoutPreference) {
    response.headers.set("CDN-Cache-Control", "no-store");
    response.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const normalizedPath = stripLocalePath(request.nextUrl.pathname);
  const locale = resolveRequestedLocale(request);
  const redirectResponse = localeRedirect(request, locale);
  if (redirectResponse) {
    return redirectResponse;
  }
  const localeResponse = createLocaleResponse(request, locale);

  if (bypassGlobalAccess(normalizedPath) || !hasGlobalContentAccessRules()) {
    return applyDocumentCachePolicy(request, localeResponse, normalizedPath);
  }

  const user = getCurrentUserFromRequest(request);
  const access = checkContentAccess(request.headers, {
    scope: "site",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (access.allowed) {
    return applyDocumentCachePolicy(request, localeResponse, normalizedPath);
  }

  const responseHeaders = new Headers({ "Cache-Control": "no-store" });
  if (access.retryAfterSeconds) {
    responseHeaders.set("Retry-After", String(access.retryAfterSeconds));
  }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, message: access.message },
      { status: access.status, headers: responseHeaders },
    );
  }

  const blockedUrl = request.nextUrl.clone();
  blockedUrl.pathname = "/access-denied";
  blockedUrl.search = "";
  const response = NextResponse.rewrite(blockedUrl, { status: access.status });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (access.retryAfterSeconds) {
    response.headers.set("Retry-After", String(access.retryAfterSeconds));
  }
  return response;
}

export const config = {
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|api/live|api/ready|api/version|site-icon/|default-avatars/|avatar-widgets/|media-file/|.*\.(?:svg|png|jpg|jpeg|webp|avif|ico|css|js|map|woff2?)$).*)"],
};
