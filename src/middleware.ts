import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkContentAccess, hasGlobalContentAccessRules } from "@/lib/content-access";
import { getCurrentUserFromRequest } from "@/lib/user-auth";

function bypassGlobalAccess(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/access-denied" ||
    pathname === "/api/health" ||
    pathname === "/api/site-icon" ||
    pathname === "/favicon.ico" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
}

export function middleware(request: NextRequest) {
  if (bypassGlobalAccess(request.nextUrl.pathname) || !hasGlobalContentAccessRules()) {
    return NextResponse.next();
  }

  const user = getCurrentUserFromRequest(request);
  const access = checkContentAccess(request.headers, {
    scope: "site",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (access.allowed) {
    return NextResponse.next();
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
  matcher: ["/((?!_next/static|_next/image).*)"],
};
