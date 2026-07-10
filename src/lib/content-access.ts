import { getClientIp } from "./admin-access";
import { getContentRateLimitRules, shouldBlockHeadlessBrowsers } from "./config";
import { checkIpRateLimit } from "./ip-rate-limit";

const HEADLESS_UA_PATTERN = /HeadlessChrome|Playwright|Puppeteer|PhantomJS|Selenium|Cypress|python-requests|Scrapy|curl|wget/i;

type HeaderReader = {
  get(name: string): string | null;
};

export type ContentAccessResult =
  | { allowed: true }
  | { allowed: false; message: string; retryAfterSeconds?: number; status: number };

export function checkContentAccess(headers: HeaderReader): ContentAccessResult {
  const userAgent = headers.get("user-agent") || "";
  if (shouldBlockHeadlessBrowsers() && HEADLESS_UA_PATTERN.test(userAgent)) {
    return { allowed: false, message: "当前客户端不能访问正文页面", status: 403 };
  }

  const limit = checkIpRateLimit({
    category: "content",
    ip: getClientIp(headers as Headers),
    rules: getContentRateLimitRules(),
  });

  if (!limit.allowed) {
    return {
      allowed: false,
      message: limit.permanent ? "当前 IP 已被永久禁止访问正文" : `正文访问太频繁，请 ${limit.retryAfterSeconds} 秒后再试`,
      retryAfterSeconds: limit.retryAfterSeconds,
      status: 429,
    };
  }

  return { allowed: true };
}
