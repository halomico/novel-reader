import { isIP } from "node:net";
import { getDb } from "./db";
import { checkRateLimit, clearRateLimitBucketsByPrefix } from "./rate-limit";
import type { IpRateLimitRule } from "./site-settings";

export type RateLimitCategory = "search" | "content";

type IpRateLimitBanRow = {
  category: RateLimitCategory;
  ip: string;
  rule_id: string;
  is_permanent: number;
  banned_until: number | null;
  created_at: string;
  updated_at: string;
};

export type IpRateLimitBan = {
  category: RateLimitCategory;
  ip: string;
  ruleId: string;
  permanent: boolean;
  bannedUntil: number | null;
  createdAt: string;
  updatedAt: string;
};

export type IpRateLimitBanKey = Pick<IpRateLimitBan, "category" | "ip">;

export type IpRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  permanent: boolean;
  ruleId?: string;
};

function toBan(row: IpRateLimitBanRow): IpRateLimitBan {
  return {
    category: row.category,
    ip: row.ip,
    ruleId: row.rule_id,
    permanent: row.is_permanent === 1,
    bannedUntil: row.banned_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function parseIpRateLimitBanKey(value: unknown): IpRateLimitBanKey | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as { category?: unknown; ip?: unknown };
    const category = parsed.category === "search" || parsed.category === "content" ? parsed.category : null;
    const ip = typeof parsed.ip === "string" ? parsed.ip.trim() : "";
    return category && isIP(ip) ? { category, ip } : null;
  } catch {
    return null;
  }
}

export function ipRateLimitRuleApplies(
  rule: IpRateLimitRule,
  context: { authenticated?: boolean; shortQuery?: boolean },
): boolean {
  if (!rule.enabled) {
    return false;
  }
  if (rule.scope === "guest" && context.authenticated) {
    return false;
  }
  if (rule.scope === "user" && !context.authenticated) {
    return false;
  }
  return rule.queryType !== "short" || Boolean(context.shortQuery);
}

function getActiveIpRateLimitBan(category: RateLimitCategory, ip: string, now: number): IpRateLimitBan | null {
  const row = getDb()
    .prepare(
      `SELECT category, ip, rule_id, is_permanent, banned_until, created_at, updated_at
       FROM rate_limit_bans
       WHERE category = ? AND ip = ?`,
    )
    .get(category, ip) as IpRateLimitBanRow | undefined;
  if (!row) {
    return null;
  }

  if (row.is_permanent !== 1 && (!row.banned_until || row.banned_until <= now)) {
    getDb().prepare("DELETE FROM rate_limit_bans WHERE category = ? AND ip = ?").run(category, ip);
    return null;
  }
  return toBan(row);
}

function saveIpRateLimitBan(
  category: RateLimitCategory,
  ip: string,
  rule: IpRateLimitRule,
  now: number,
): IpRateLimitBan | null {
  if (!isIP(ip) || rule.banMode === "none") {
    return null;
  }

  const existing = getActiveIpRateLimitBan(category, ip, now);
  if (existing?.permanent) {
    return existing;
  }

  const permanent = rule.banMode === "permanent";
  const bannedUntil = permanent ? null : now + rule.banSeconds * 1_000;
  if (!permanent && existing?.bannedUntil && existing.bannedUntil >= (bannedUntil || 0)) {
    return existing;
  }

  getDb()
    .prepare(
      `INSERT INTO rate_limit_bans (category, ip, rule_id, is_permanent, banned_until)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(category, ip) DO UPDATE SET
         rule_id = excluded.rule_id,
         is_permanent = excluded.is_permanent,
         banned_until = excluded.banned_until,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .run(category, ip, rule.id, permanent ? 1 : 0, bannedUntil);
  return getActiveIpRateLimitBan(category, ip, now);
}

function strongerBanRule(current: IpRateLimitRule | null, candidate: IpRateLimitRule): IpRateLimitRule {
  if (!current || candidate.banMode === "permanent") {
    return candidate;
  }
  if (current.banMode === "permanent") {
    return current;
  }
  if (candidate.banMode === "temporary" && (current.banMode === "none" || candidate.banSeconds > current.banSeconds)) {
    return candidate;
  }
  return current;
}

export function checkIpRateLimit(params: {
  category: RateLimitCategory;
  ip: string;
  authenticated?: boolean;
  shortQuery?: boolean;
  rules: IpRateLimitRule[];
  now?: number;
}): IpRateLimitResult {
  const now = params.now ?? Date.now();
  const activeBan = getActiveIpRateLimitBan(params.category, params.ip, now);
  if (activeBan) {
    return {
      allowed: false,
      retryAfterSeconds: activeBan.permanent ? 0 : Math.max(1, Math.ceil(((activeBan.bannedUntil || now) - now) / 1_000)),
      permanent: activeBan.permanent,
      ruleId: activeBan.ruleId,
    };
  }

  let retryAfterSeconds = 0;
  let violatedRule: IpRateLimitRule | null = null;
  for (const rule of params.rules) {
    if (!ipRateLimitRuleApplies(rule, params)) {
      continue;
    }

    const result = checkRateLimit({
      key: `${params.category}:ip:${params.ip}:rule:${rule.id}`,
      limit: rule.maxRequests,
      windowMs: rule.windowSeconds * 1_000,
      now,
    });
    if (!result.allowed) {
      retryAfterSeconds = Math.max(retryAfterSeconds, result.retryAfterSeconds);
      violatedRule = strongerBanRule(violatedRule, rule);
    }
  }

  if (!violatedRule) {
    return { allowed: true, retryAfterSeconds: 0, permanent: false };
  }

  const ban = saveIpRateLimitBan(params.category, params.ip, violatedRule, now);
  if (ban) {
    return {
      allowed: false,
      retryAfterSeconds: ban.permanent ? 0 : Math.max(1, Math.ceil(((ban.bannedUntil || now) - now) / 1_000)),
      permanent: ban.permanent,
      ruleId: ban.ruleId,
    };
  }

  return {
    allowed: false,
    retryAfterSeconds,
    permanent: false,
    ruleId: violatedRule.id,
  };
}

export function listIpRateLimitBans(category: RateLimitCategory, limit = 100, now = Date.now()): IpRateLimitBan[] {
  getDb()
    .prepare(
      "DELETE FROM rate_limit_bans WHERE category = ? AND is_permanent = 0 AND (banned_until IS NULL OR banned_until <= ?)",
    )
    .run(category, now);
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT category, ip, rule_id, is_permanent, banned_until, created_at, updated_at
       FROM rate_limit_bans
       WHERE category = ?
       ORDER BY is_permanent DESC, COALESCE(banned_until, 9223372036854775807) DESC
       LIMIT ?`,
    )
    .all(category, safeLimit) as IpRateLimitBanRow[];
  return rows.map(toBan);
}

export function deleteIpRateLimitBan(category: RateLimitCategory, ip: string): boolean {
  if (!isIP(ip)) {
    return false;
  }

  const deleted = getDb().prepare("DELETE FROM rate_limit_bans WHERE category = ? AND ip = ?").run(category, ip).changes > 0;
  if (deleted) {
    clearRateLimitBucketsByPrefix(`${category}:ip:${ip}:rule:`);
  }
  return deleted;
}

export function deleteIpRateLimitBans(bans: IpRateLimitBanKey[]): number {
  const uniqueBans = new Map<string, IpRateLimitBanKey>();
  for (const ban of bans) {
    if ((ban.category === "search" || ban.category === "content") && isIP(ban.ip)) {
      uniqueBans.set(`${ban.category}\0${ban.ip}`, ban);
    }
  }

  let deleted = 0;
  for (const ban of uniqueBans.values()) {
    deleted += deleteIpRateLimitBan(ban.category, ban.ip) ? 1 : 0;
  }
  return deleted;
}
