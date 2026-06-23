import {
  getAdminAllowedIps,
  getAdminBlockedIps,
  getAdminOutboundAllowedIps,
  getAdminOutboundBlockedIps,
  isAdminEnabled,
} from "./config";

export type AdminAccessState = {
  allowed: boolean;
  clientIp: string;
  reason?: string;
};

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  let value = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const numericPart = Number(part);
    if (numericPart < 0 || numericPart > 255) {
      return null;
    }
    value = (value << 8) + numericPart;
  }
  return value >>> 0;
}

export function matchesIpRule(ip: string, rule: string): boolean {
  const normalizedRule = rule.trim();
  if (!normalizedRule) {
    return false;
  }

  if (normalizedRule === "*") {
    return true;
  }

  if (normalizedRule.includes("*")) {
    const prefix = normalizedRule.replace(/\*+$/, "");
    return ip.startsWith(prefix);
  }

  if (normalizedRule.includes("/")) {
    const [baseIp, prefixText] = normalizedRule.split("/");
    const base = ipv4ToNumber(baseIp);
    const target = ipv4ToNumber(ip);
    const prefix = Number(prefixText);
    if (base === null || target === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      return false;
    }
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (base & mask) === (target & mask);
  }

  return ip === normalizedRule;
}

function matchesAny(ip: string, rules: string[]): boolean {
  return rules.some((rule) => matchesIpRule(ip, rule));
}

export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

export function getAdminAccessState(headers: Headers): AdminAccessState {
  if (!isAdminEnabled()) {
    return { allowed: false, clientIp: getClientIp(headers), reason: "后台管理未启用" };
  }

  const clientIp = getClientIp(headers);
  const blockedIps = getAdminBlockedIps();
  const allowedIps = getAdminAllowedIps();

  if (matchesAny(clientIp, blockedIps)) {
    return { allowed: false, clientIp, reason: "当前 IP 已被黑名单拦截" };
  }

  if (allowedIps.length > 0 && !matchesAny(clientIp, allowedIps)) {
    return { allowed: false, clientIp, reason: "当前 IP 不在后台白名单内" };
  }

  return { allowed: true, clientIp };
}

export function canUseOutboundIp(ip: string): boolean {
  const blockedIps = getAdminOutboundBlockedIps();
  const allowedIps = getAdminOutboundAllowedIps();
  if (matchesAny(ip, blockedIps)) {
    return false;
  }
  return allowedIps.length === 0 || matchesAny(ip, allowedIps);
}
