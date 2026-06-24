import { persistBlockedIp } from "./admin-ban";
import {
  getAdminOperationRateLimitPerMinute,
  isAdminOperationRateLimitEnabled,
  shouldAdminOperationRateLimitBan,
} from "./config";
import { checkRateLimit } from "./rate-limit";

export function checkAdminOperationLimit(clientIp: string, scope: string): string {
  if (!isAdminOperationRateLimitEnabled()) {
    return "";
  }

  const limit = checkRateLimit({
    key: `admin-op:${scope}:${clientIp}`,
    limit: getAdminOperationRateLimitPerMinute(),
    windowMs: 60_000,
  });

  if (limit.allowed) {
    return "";
  }

  const blocked = shouldAdminOperationRateLimitBan() && persistBlockedIp(clientIp);
  return blocked ? "后台操作太频繁，当前 IP 已加入黑名单" : `后台操作太频繁，请 ${limit.retryAfterSeconds} 秒后再试`;
}
