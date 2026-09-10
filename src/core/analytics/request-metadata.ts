import { getTrustedClientAddress, type HeaderReader } from "@/core/security/client-ip";

export type RequestAnalyticsMetadata = Readonly<{
  ip: string;
  country: string;
  userAgent: string;
  referrer: string;
  device: string;
  browser: string;
  os: string;
}>;

function boundedText(value: string | null | undefined, maximum: number): string {
  if (typeof value !== "string") return "";
  if (!value.isWellFormed() || value.includes("\0")) throw new TypeError("Invalid analytics text");
  return Array.from(value.trim()).slice(0, maximum).join("");
}

export function parseUserAgentFamily(userAgent: string): Pick<RequestAnalyticsMetadata, "device" | "browser" | "os"> {
  const value = userAgent.toLocaleLowerCase("en-US");
  const bot = /bot|crawler|spider|slurp|headless|phantom|selenium|playwright/u.test(value);
  const tablet = /ipad|tablet/u.test(value) || (/android/u.test(value) && !/mobile/u.test(value));
  const mobile = !tablet && /iphone|ipod|android.*mobile|windows phone|mobile/u.test(value);
  const device = bot ? "bot" : tablet ? "tablet" : mobile ? "mobile" : "desktop";
  const browser = /edg\//u.test(value)
    ? "edge"
    : /opr\/|opera/u.test(value)
      ? "opera"
      : /micromessenger/u.test(value)
        ? "wechat"
        : /samsungbrowser/u.test(value)
          ? "samsung"
          : /firefox\//u.test(value)
            ? "firefox"
            : /chrome\/|crios\//u.test(value)
              ? "chrome"
              : /safari\//u.test(value)
                ? "safari"
                : "unknown";
  const os = /windows/u.test(value)
    ? "windows"
    : /iphone|ipad|ipod/u.test(value)
      ? "ios"
      : /android/u.test(value)
        ? "android"
        : /mac os x|macintosh/u.test(value)
          ? "macos"
          : /linux/u.test(value)
            ? "linux"
            : "unknown";
  return { device, browser, os };
}

export function requestAnalyticsMetadata(
  headers: HeaderReader,
  referrerValue?: string | null,
): RequestAnalyticsMetadata {
  const address = getTrustedClientAddress(headers);
  const userAgent = boundedText(headers.get("user-agent"), 240);
  const referrer = boundedText(referrerValue, 320) || "direct";
  return {
    ip: address.ip,
    country: address.country,
    userAgent,
    referrer,
    ...parseUserAgentFamily(userAgent),
  };
}
