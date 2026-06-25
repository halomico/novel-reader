import { BlockList, isIP } from "node:net";
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

function normalizeIpLiteral(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const bracketedIpv6 = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) {
    return bracketedIpv6[1];
  }

  if (isIP(trimmed)) {
    return trimmed;
  }

  const ipv4WithPort = trimmed.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  return ipv4WithPort ? ipv4WithPort[1] : trimmed;
}

function ipVariants(value: string): string[] {
  const normalized = normalizeIpLiteral(value);
  const variants = new Set([normalized]);
  const mappedIpv4 = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4 && isIP(mappedIpv4[1]) === 4) {
    variants.add(mappedIpv4[1]);
  }
  return Array.from(variants);
}

function ipType(family: 4 | 6): "ipv4" | "ipv6" {
  return family === 4 ? "ipv4" : "ipv6";
}

function matchesExactIp(ip: string, rule: string): boolean {
  for (const ruleVariant of ipVariants(rule)) {
    const ruleFamily = isIP(ruleVariant);
    if (ruleFamily !== 4 && ruleFamily !== 6) {
      continue;
    }

    const blockList = new BlockList();
    blockList.addAddress(ruleVariant, ipType(ruleFamily));
    for (const ipVariant of ipVariants(ip)) {
      if (isIP(ipVariant) === ruleFamily && blockList.check(ipVariant, ipType(ruleFamily))) {
        return true;
      }
    }
  }

  return normalizeIpLiteral(ip) === normalizeIpLiteral(rule);
}

function matchesCidrIp(ip: string, rule: string): boolean {
  const [baseIpText, prefixText] = rule.split("/");
  const baseIp = normalizeIpLiteral(baseIpText || "");
  const baseFamily = isIP(baseIp);
  const prefix = Number(prefixText);
  if (
    (baseFamily !== 4 && baseFamily !== 6) ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > (baseFamily === 4 ? 32 : 128)
  ) {
    return false;
  }

  const blockList = new BlockList();
  blockList.addSubnet(baseIp, prefix, ipType(baseFamily));
  return ipVariants(ip).some((ipVariant) => isIP(ipVariant) === baseFamily && blockList.check(ipVariant, ipType(baseFamily)));
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
    const prefix = normalizedRule.replace(/\*+$/, "").toLowerCase();
    return ipVariants(ip).some((ipVariant) => ipVariant.startsWith(prefix));
  }

  if (normalizedRule.includes("/")) {
    return matchesCidrIp(ip, normalizedRule);
  }

  return matchesExactIp(ip, normalizedRule);
}

function matchesAny(ip: string, rules: string[]): boolean {
  return rules.some((rule) => matchesIpRule(ip, rule));
}

export function getClientIp(headers: Headers): string {
  const clientIp =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "unknown";
  return clientIp === "unknown" ? clientIp : normalizeIpLiteral(clientIp);
}

export function getAdminAccessState(headers: Headers): AdminAccessState {
  const clientIp = getClientIp(headers);
  if (!isAdminEnabled()) {
    return { allowed: false, clientIp, reason: "后台管理未启用" };
  }

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
