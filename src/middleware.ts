import { NextRequest, NextResponse } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const contentBuckets = new Map<string, Bucket>();
const HEADLESS_UA_PATTERN = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Selenium|Cypress|python-requests|Scrapy|curl|wget/i;

function readInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(value), min), max);
}

function readBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function getClientKey(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const userAgent = request.headers.get("user-agent") || "unknown";
  return `${forwardedFor || realIp || "unknown"}:${userAgent.slice(0, 96)}`;
}

function checkRateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = contentBuckets.get(key);

  if (!existing || existing.resetAt <= now) {
    contentBuckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

function plainResponse(message: string, status: number, retryAfterSeconds?: number): NextResponse {
  const response = new NextResponse(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Robots-Tag": "noindex, noarchive",
    },
  });

  if (retryAfterSeconds) {
    response.headers.set("Retry-After", String(retryAfterSeconds));
  }

  return response;
}

export function middleware(request: NextRequest) {
  const userAgent = request.headers.get("user-agent") || "";
  const shouldBlockHeadless = readBool("CONTENT_BLOCK_HEADLESS_BROWSERS", true);

  if (shouldBlockHeadless && HEADLESS_UA_PATTERN.test(userAgent)) {
    return plainResponse("Forbidden", 403);
  }

  const perMinute = readInt("CONTENT_RATE_LIMIT_PER_MINUTE", 60, 1, 600);
  const windowSeconds = readInt("CONTENT_RATE_LIMIT_WINDOW_SECONDS", 60, 10, 3600);
  const limit = checkRateLimit(getClientKey(request), perMinute, windowSeconds * 1000);

  if (!limit.allowed) {
    return plainResponse("Too Many Requests", 429, limit.retryAfterSeconds);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/books/:path*"],
};
