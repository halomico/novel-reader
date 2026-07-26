import { BlockList, isIP } from "node:net";
import { isAdminEnabled } from "./config";
import { readSiteSettings } from "./site-settings";

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

export function normalizeAdminNetworkRules(value: unknown): string[] {
  const source = Array.isArray(value) ? value.map(String) : String(value || "").split(/[\n,，]+/u);
  const rules: string[] = [];
  for (const raw of source) {
    const rule = raw.trim().toLowerCase();
    if (!rule) continue;
    if (rule.includes("/")) {
      const [base, prefixText, extra] = rule.split("/");
      const family = isIP(base || "");
      const prefix = Number(prefixText);
      if (
        extra === undefined &&
        (family === 4 || family === 6) &&
        Number.isInteger(prefix) &&
        prefix >= 0 &&
        prefix <= (family === 4 ? 32 : 128)
      ) {
        rules.push(`${base}/${prefix}`);
      }
    } else if (isIP(rule)) {
      rules.push(rule);
    }
    if (rules.length >= 100) break;
  }
  return Array.from(new Set(rules));
}

export function getClientIp(headers: Headers): string {
  const clientIp =
    headers.get("cf-connecting-ip")?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown";
  return clientIp === "unknown" ? clientIp : normalizeIpLiteral(clientIp);
}

export function getAdminAccessState(headers: Headers): AdminAccessState {
  const clientIp = getClientIp(headers);
  if (!isAdminEnabled()) {
    return { allowed: false, clientIp, reason: "后台管理未启用" };
  }
  const settings = readSiteSettings();
  if (
    settings.adminIpAllowlistEnabled &&
    !settings.adminAllowedNetworks.some((rule) => matchesIpRule(clientIp, rule))
  ) {
    return { allowed: false, clientIp, reason: "当前网络不在后台访问白名单" };
  }

  return { allowed: true, clientIp };
}
