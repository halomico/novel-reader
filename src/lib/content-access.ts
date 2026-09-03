import { isIP } from "node:net";
import { getTrustedRequestCountry } from "@/core/security/client-ip";
import { getClientIp, matchesIpRule } from "./admin-access";
import { getDb } from "./db";
import { checkRateLimit, clearRateLimitBucketsByPrefix } from "./rate-limit";

export type ContentAccessScope = "all" | "novel" | "video" | "audio" | "file";
export type ContentAccessRequestScope = "site" | "novel" | "video" | "audio" | "file";
export type ContentAccessAudience = "all" | "guest";
export type ContentAccessTargetType = "ip" | "cidr" | "country" | "crawler";
export type ContentAccessMatchMode = "include" | "exclude";
export type ContentAccessCountryMode = "all" | "cn" | "non_cn";
export type ContentAccessRuleSource = "manual" | "rate_limit";

export type ContentAccessRule = {
  id: number;
  targetType: ContentAccessTargetType;
  targetValue: string;
  matchMode: ContentAccessMatchMode;
  scope: ContentAccessScope;
  countryMode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  source: ContentAccessRuleSource;
  reason: string;
  expiresAt: number | null;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ContentAccessPolicy = {
  id: number;
  name: string;
  enabled: boolean;
  scope: ContentAccessScope;
  countryMode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  windowSeconds: number;
  maxRequests: number;
  blockSeconds: number;
  createdAt: string;
  updatedAt: string;
};

export type ContentAccessResult =
  | { allowed: true }
  | {
      allowed: false;
      message: string;
      retryAfterSeconds?: number;
      status: 403 | 429;
      ruleId: number;
    };

type HeaderReader = {
  get(name: string): string | null;
};

type ContentAccessRuleRow = {
  id: number;
  target_type: ContentAccessTargetType;
  target_value: string;
  match_mode: ContentAccessMatchMode;
  scope: ContentAccessScope;
  country_mode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  source: ContentAccessRuleSource;
  reason: string;
  expires_at: number | null;
  enabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ContentAccessPolicyRow = {
  id: number;
  name: string;
  enabled: number;
  scope: ContentAccessScope;
  country_mode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  window_seconds: number;
  max_requests: number;
  block_seconds: number;
  created_at: string;
  updated_at: string;
};

type ContentAccessGlobal = typeof globalThis & {
  contentAccessCache?: {
    expiresAt: number;
    rules: ContentAccessRule[];
    policies: ContentAccessPolicy[];
  };
  contentAccessCleanupAt?: number;
};

const CACHE_MS = 2_000;
const CLEANUP_INTERVAL_MS = 5 * 60_000;

export class ContentAccessInputError extends Error {}

function toRule(row: ContentAccessRuleRow): ContentAccessRule {
  return {
    id: row.id,
    targetType: row.target_type,
    targetValue: row.target_value,
    matchMode: row.match_mode,
    scope: row.scope,
    countryMode: row.country_mode,
    audience: row.audience,
    source: row.source,
    reason: row.reason,
    expiresAt: row.expires_at,
    enabled: row.enabled === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPolicy(row: ContentAccessPolicyRow): ContentAccessPolicy {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    scope: row.scope,
    countryMode: row.country_mode,
    audience: row.audience,
    windowSeconds: row.window_seconds,
    maxRequests: row.max_requests,
    blockSeconds: row.block_seconds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(Math.max(Math.floor(numeric), min), max)
    : fallback;
}

function normalizeScope(value: unknown): ContentAccessScope {
  return value === "novel" || value === "video" || value === "audio" || value === "file"
    ? value
    : "all";
}

function normalizeCountryMode(value: unknown): ContentAccessCountryMode {
  return value === "cn" || value === "non_cn" ? value : "all";
}

function normalizeAudience(value: unknown): ContentAccessAudience {
  return value === "guest" ? "guest" : "all";
}

function normalizeTargetType(value: unknown): ContentAccessTargetType {
  if (value === "cidr" || value === "country" || value === "crawler") {
    return value;
  }
  return "ip";
}

function normalizeMatchMode(type: ContentAccessTargetType, value: unknown): ContentAccessMatchMode {
  return type === "country" && value === "exclude" ? "exclude" : "include";
}

function normalizeTargetValue(type: ContentAccessTargetType, value: unknown): string {
  if (type === "crawler") {
    return value === "crawler" || value === "headless" ? value : "all";
  }
  const text = String(value || "").trim();
  if (type === "ip") {
    if (!isIP(text)) {
      throw new ContentAccessInputError("请输入有效的 IPv4 或 IPv6 地址");
    }
    return text.toLowerCase();
  }
  if (type === "cidr") {
    const parts = text.split("/");
    const family = isIP(parts[0] || "");
    const prefix = Number(parts[1]);
    const maximum = family === 4 ? 32 : 128;
    if (parts.length !== 2 || !family || !Number.isInteger(prefix) || prefix < 0 || prefix > maximum) {
      throw new ContentAccessInputError("请输入有效的 CIDR 网段");
    }
    return `${parts[0].toLowerCase()}/${prefix}`;
  }

  const countries = [...new Set(
    text
      .split(/[\s,，、]+/)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  )];
  if (
    !countries.length ||
    countries.length > 32 ||
    countries.some((country) => !/^(?:[A-Z]{2}|T1)$/.test(country))
  ) {
    throw new ContentAccessInputError("请选择 1 至 32 个有效国家代码");
  }
  return countries.sort().join(",");
}

function clearContentAccessCache() {
  delete (globalThis as ContentAccessGlobal).contentAccessCache;
}

function cleanupExpiredRules(now: number) {
  const state = globalThis as ContentAccessGlobal;
  if ((state.contentAccessCleanupAt || 0) > now) {
    return;
  }
  getDb().prepare("DELETE FROM content_access_rules WHERE expires_at IS NOT NULL AND expires_at <= ?").run(now);
  state.contentAccessCleanupAt = now + CLEANUP_INTERVAL_MS;
  clearContentAccessCache();
}

function readActiveAccessConfig(now: number) {
  cleanupExpiredRules(now);
  const state = globalThis as ContentAccessGlobal;
  if (state.contentAccessCache && state.contentAccessCache.expiresAt > now) {
    return state.contentAccessCache;
  }

  const rules = (getDb()
    .prepare(
      `SELECT id, target_type, target_value, match_mode, scope, country_mode, audience, source, reason, expires_at,
              enabled, created_by, created_at, updated_at
       FROM content_access_rules
       WHERE enabled = 1 AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY source ASC, id ASC`,
    )
    .all(now) as ContentAccessRuleRow[]).map(toRule);
  const policies = (getDb()
    .prepare(
      `SELECT id, name, enabled, scope, country_mode, audience, window_seconds, max_requests,
              block_seconds, created_at, updated_at
       FROM content_access_policies
       WHERE enabled = 1
       ORDER BY id ASC`,
    )
    .all() as ContentAccessPolicyRow[]).map(toPolicy);
  const value = { rules, policies, expiresAt: now + CACHE_MS };
  state.contentAccessCache = value;
  return value;
}

export function getRequestCountry(headers: HeaderReader): string {
  return getTrustedRequestCountry(headers);
}

function scopeMatches(configured: ContentAccessScope, requested: ContentAccessRequestScope): boolean {
  return configured === "all" || configured === requested;
}

function audienceMatches(configured: ContentAccessAudience, authenticated: boolean): boolean {
  return configured === "all" || !authenticated;
}

function countryModeMatches(configured: ContentAccessCountryMode, country: string): boolean {
  if (configured === "all") return true;
  if (country === "unknown") return false;
  return configured === "cn" ? country === "CN" : country !== "CN";
}

export function hasScopedContentAccessRules(
  scope: Exclude<ContentAccessScope, "all">,
  now = Date.now(),
): boolean {
  return readActiveAccessConfig(now).rules.some((rule) => scopeMatches(rule.scope, scope));
}

export function hasScopedContentAccessControls(
  scope: Exclude<ContentAccessScope, "all">,
  now = Date.now(),
): boolean {
  const config = readActiveAccessConfig(now);
  return config.rules.some((rule) => scopeMatches(rule.scope, scope)) ||
    config.policies.some((policy) => scopeMatches(policy.scope, scope));
}

export function hasGlobalContentAccessRules(now = Date.now()): boolean {
  return readActiveAccessConfig(now).rules.some((rule) => rule.scope === "all");
}

const SEARCH_CRAWLER_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|bytespider|yandex|baiduspider|sogou/i;
const HEADLESS_BROWSER_PATTERN = /headless|phantom|selenium|playwright|puppeteer/i;

export function isLikelyHeadlessBrowser(userAgent: string): boolean {
  return HEADLESS_BROWSER_PATTERN.test(userAgent);
}

export function isLikelyCrawler(userAgent: string): boolean {
  return SEARCH_CRAWLER_PATTERN.test(userAgent) || isLikelyHeadlessBrowser(userAgent);
}

function crawlerProfileMatches(profile: string, userAgent: string): boolean {
  if (profile === "crawler") return SEARCH_CRAWLER_PATTERN.test(userAgent);
  if (profile === "headless") return isLikelyHeadlessBrowser(userAgent);
  return isLikelyCrawler(userAgent);
}

function ruleMatches(
  rule: ContentAccessRule,
  context: {
    ip: string;
    country: string;
    userAgent: string;
    scope: ContentAccessRequestScope;
    authenticated: boolean;
  },
): boolean {
  if (
    !scopeMatches(rule.scope, context.scope) ||
    !audienceMatches(rule.audience, context.authenticated) ||
    !countryModeMatches(rule.countryMode, context.country)
  ) {
    return false;
  }
  if (rule.targetType === "country") {
    const matches = rule.targetValue.split(",").includes(context.country);
    return rule.matchMode === "exclude" ? !matches : matches;
  }
  if (rule.targetType === "crawler") {
    return crawlerProfileMatches(rule.targetValue, context.userAgent);
  }
  if (!isIP(context.ip)) {
    return false;
  }
  return rule.targetType === "ip"
    ? context.ip.toLowerCase() === rule.targetValue.toLowerCase()
    : matchesIpRule(context.ip, rule.targetValue);
}

function saveTemporaryRateLimitRule(params: {
  ip: string;
  scope: ContentAccessScope;
  countryMode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  expiresAt: number;
  policyName: string;
}): ContentAccessRule {
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT id, expires_at
       FROM content_access_rules
       WHERE target_type = 'ip' AND target_value = ? AND scope = ? AND country_mode = ? AND audience = ?
          AND source = 'rate_limit' AND enabled = 1
       ORDER BY id DESC LIMIT 1`,
    )
    .get(params.ip.toLowerCase(), params.scope, params.countryMode, params.audience) as { id: number; expires_at: number | null } | undefined;
  let id: number;
  if (existing) {
    id = existing.id;
    db.prepare(
      `UPDATE content_access_rules
       SET reason = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(params.policyName, Math.max(existing.expires_at || 0, params.expiresAt), id);
  } else {
    const result = db.prepare(
      `INSERT INTO content_access_rules
        (target_type, target_value, scope, country_mode, audience, source, reason, expires_at)
       VALUES ('ip', ?, ?, ?, ?, 'rate_limit', ?, ?)`,
    ).run(params.ip.toLowerCase(), params.scope, params.countryMode, params.audience, params.policyName, params.expiresAt);
    id = Number(result.lastInsertRowid);
  }
  clearContentAccessCache();
  return getContentAccessRule(id)!;
}

export function checkContentAccess(
  headers: HeaderReader,
  options: {
    scope?: ContentAccessRequestScope;
    authenticated?: boolean;
    admin?: boolean;
    rateLimit?: boolean;
    now?: number;
  } = {},
): ContentAccessResult {
  if (options.admin) {
    return { allowed: true };
  }

  const now = options.now ?? Date.now();
  const scope = options.scope || "novel";
  const authenticated = Boolean(options.authenticated);
  const ip = getClientIp(headers as Headers);
  const country = getRequestCountry(headers);
  const userAgent = headers.get("user-agent") || "";
  const config = readActiveAccessConfig(now);
  const context = { ip, country, userAgent, scope, authenticated };
  const blockedBy = config.rules.find((rule) => ruleMatches(rule, context));
  if (blockedBy) {
    if (blockedBy.source === "rate_limit") {
      const retryAfterSeconds = blockedBy.expiresAt
        ? Math.max(1, Math.ceil((blockedBy.expiresAt - now) / 1_000))
        : undefined;
      return {
        allowed: false,
        message: retryAfterSeconds ? `访问过于频繁，请 ${retryAfterSeconds} 秒后再试` : "访问过于频繁，请稍后再试",
        retryAfterSeconds,
        status: 429,
        ruleId: blockedBy.id,
      };
    }
    return {
      allowed: false,
      message: scope === "site" ? "当前网络暂不能访问本站" : "当前网络暂不能访问该内容",
      status: 403,
      ruleId: blockedBy.id,
    };
  }

  if (options.rateLimit === false || !isIP(ip)) {
    return { allowed: true };
  }
  for (const policy of config.policies) {
    if (
      !scopeMatches(policy.scope, scope) ||
      !audienceMatches(policy.audience, authenticated) ||
      !countryModeMatches(policy.countryMode, country)
    ) {
      continue;
    }
    const limit = checkRateLimit({
      key: `content-access:${policy.id}:${ip}`,
      limit: policy.maxRequests,
      windowMs: policy.windowSeconds * 1_000,
      now,
    });
    if (!limit.allowed) {
      const rule = saveTemporaryRateLimitRule({
        ip,
        scope: policy.scope,
        countryMode: policy.countryMode,
        audience: policy.audience,
        expiresAt: now + policy.blockSeconds * 1_000,
        policyName: policy.name,
      });
      return {
        allowed: false,
        message: `访问过于频繁，请 ${policy.blockSeconds} 秒后再试`,
        retryAfterSeconds: policy.blockSeconds,
        status: 429,
        ruleId: rule.id,
      };
    }
  }
  return { allowed: true };
}

export function getContentAccessRule(id: number): ContentAccessRule | null {
  const row = getDb()
    .prepare(
      `SELECT id, target_type, target_value, match_mode, scope, country_mode, audience, source, reason, expires_at,
              enabled, created_by, created_at, updated_at
       FROM content_access_rules WHERE id = ?`,
    )
    .get(id) as ContentAccessRuleRow | undefined;
  return row ? toRule(row) : null;
}

export function listContentAccessRules(limit = 300): ContentAccessRule[] {
  cleanupExpiredRules(Date.now());
  const safeLimit = cleanInt(limit, 300, 1, 1_000);
  return (getDb()
    .prepare(
      `SELECT id, target_type, target_value, match_mode, scope, country_mode, audience, source, reason, expires_at,
              enabled, created_by, created_at, updated_at
       FROM content_access_rules
       ORDER BY enabled DESC, source ASC, expires_at IS NULL DESC, expires_at DESC, id DESC
       LIMIT ?`,
    )
    .all(safeLimit) as ContentAccessRuleRow[]).map(toRule);
}

export function saveContentAccessRule(input: {
  id?: number;
  targetType: unknown;
  targetValue: unknown;
  matchMode?: unknown;
  scope?: unknown;
  countryMode?: unknown;
  audience?: unknown;
  reason?: unknown;
  expiresAt?: number | null;
  enabled?: boolean;
  createdBy?: string;
}): ContentAccessRule {
  const id = cleanInt(input.id, 0, 0, Number.MAX_SAFE_INTEGER);
  const targetType = normalizeTargetType(input.targetType);
  const targetValue = normalizeTargetValue(targetType, input.targetValue);
  const matchMode = normalizeMatchMode(targetType, input.matchMode);
  const scope = normalizeScope(input.scope);
  const countryMode = normalizeCountryMode(input.countryMode);
  const audience = normalizeAudience(input.audience);
  const reason = String(input.reason || "").trim().slice(0, 120);
  const expiresAt = input.expiresAt && input.expiresAt > Date.now() ? Math.floor(input.expiresAt) : null;
  const enabled = input.enabled === false ? 0 : 1;
  const db = getDb();

  if (id > 0) {
    const result = db.prepare(
       `UPDATE content_access_rules
       SET target_type = ?, target_value = ?, match_mode = ?, scope = ?, country_mode = ?, audience = ?, reason = ?,
            expires_at = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND source = 'manual'`,
    ).run(targetType, targetValue, matchMode, scope, countryMode, audience, reason, expiresAt, enabled, id);
    if (!result.changes) {
      throw new ContentAccessInputError("访问规则不存在或不可编辑");
    }
  } else {
    const result = db.prepare(
      `INSERT INTO content_access_rules
        (target_type, target_value, match_mode, scope, country_mode, audience, source, reason, expires_at, enabled, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?)`,
    ).run(
      targetType,
      targetValue,
      matchMode,
      scope,
      countryMode,
      audience,
      reason,
      expiresAt,
      enabled,
      String(input.createdBy || "").slice(0, 64),
    );
    clearContentAccessCache();
    return getContentAccessRule(Number(result.lastInsertRowid))!;
  }

  clearContentAccessCache();
  return getContentAccessRule(id)!;
}

export function deleteContentAccessRule(id: number): boolean {
  const deleted = getDb().prepare("DELETE FROM content_access_rules WHERE id = ?").run(id).changes > 0;
  if (deleted) {
    clearContentAccessCache();
  }
  return deleted;
}

export function listContentAccessPolicies(): ContentAccessPolicy[] {
  return (getDb()
    .prepare(
      `SELECT id, name, enabled, scope, country_mode, audience, window_seconds, max_requests,
              block_seconds, created_at, updated_at
       FROM content_access_policies
       ORDER BY id ASC`,
    )
    .all() as ContentAccessPolicyRow[]).map(toPolicy);
}

export function saveContentAccessPolicy(input: {
  id?: number;
  name?: unknown;
  enabled?: boolean;
  scope?: unknown;
  countryMode?: unknown;
  audience?: unknown;
  windowSeconds?: unknown;
  maxRequests?: unknown;
  blockSeconds?: unknown;
}): ContentAccessPolicy {
  const id = cleanInt(input.id, 0, 0, Number.MAX_SAFE_INTEGER);
  const name = String(input.name || "内容访问保护").trim().slice(0, 40) || "内容访问保护";
  const enabled = input.enabled === false ? 0 : 1;
  const scope = normalizeScope(input.scope);
  const countryMode = normalizeCountryMode(input.countryMode);
  const audience = normalizeAudience(input.audience);
  const windowSeconds = cleanInt(input.windowSeconds, 60, 1, 86_400);
  const maxRequests = cleanInt(input.maxRequests, 60, 1, 100_000);
  const blockSeconds = cleanInt(input.blockSeconds, 300, 60, 31_536_000);
  const db = getDb();
  if (id > 0) {
    const result = db.prepare(
      `UPDATE content_access_policies
       SET name = ?, enabled = ?, scope = ?, country_mode = ?, audience = ?, window_seconds = ?,
            max_requests = ?, block_seconds = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(name, enabled, scope, countryMode, audience, windowSeconds, maxRequests, blockSeconds, id);
    if (!result.changes) {
      throw new ContentAccessInputError("访问频率规则不存在");
    }
  } else {
    const result = db.prepare(
      `INSERT INTO content_access_policies
        (name, enabled, scope, country_mode, audience, window_seconds, max_requests, block_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(name, enabled, scope, countryMode, audience, windowSeconds, maxRequests, blockSeconds);
    clearContentAccessCache();
    return listContentAccessPolicies().find((policy) => policy.id === Number(result.lastInsertRowid))!;
  }
  clearRateLimitBucketsByPrefix(`content-access:${id}:`);
  clearContentAccessCache();
  return listContentAccessPolicies().find((policy) => policy.id === id)!;
}

export function deleteContentAccessPolicy(id: number): boolean {
  const deleted = getDb().prepare("DELETE FROM content_access_policies WHERE id = ?").run(id).changes > 0;
  if (deleted) {
    clearRateLimitBucketsByPrefix(`content-access:${id}:`);
    clearContentAccessCache();
  }
  return deleted;
}
