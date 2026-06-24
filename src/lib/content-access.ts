import { getContentRateLimitPerMinute, getContentRateLimitWindowSeconds, shouldBlockHeadlessBrowsers } from "./config";
import { checkRateLimit } from "./rate-limit";

const HEADLESS_UA_PATTERN = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Selenium|Cypress|python-requests|Scrapy|curl|wget/i;

type HeaderReader = {
  get(name: string): string | null;
};

export type ContentAccessResult =
  | { allowed: true }
  | { allowed: false; message: string; retryAfterSeconds?: number; status: number };

function getClientKey(headers: HeaderReader): string {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip")?.trim();
  const userAgent = headers.get("user-agent") || "unknown";
  return `${forwardedFor || realIp || "unknown"}:${userAgent.slice(0, 96)}`;
}

export function checkContentAccess(headers: HeaderReader): ContentAccessResult {
  const userAgent = headers.get("user-agent") || "";
  if (shouldBlockHeadlessBrowsers() && HEADLESS_UA_PATTERN.test(userAgent)) {
    return { allowed: false, message: "当前客户端不能访问正文页面", status: 403 };
  }

  const limit = checkRateLimit({
    key: `content:${getClientKey(headers)}`,
    limit: getContentRateLimitPerMinute(),
    windowMs: getContentRateLimitWindowSeconds() * 1000,
  });

  if (!limit.allowed) {
    return {
      allowed: false,
      message: `正文访问太频繁，请 ${limit.retryAfterSeconds} 秒后再试`,
      retryAfterSeconds: limit.retryAfterSeconds,
      status: 429,
    };
  }

  return { allowed: true };
}
