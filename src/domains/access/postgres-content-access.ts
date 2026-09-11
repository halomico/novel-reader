import crypto from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { QueryResultRow } from "pg";
import { getTrustedClientAddress, type HeaderReader } from "@/core/security/client-ip";
import type { SqlExecutor } from "@/core/db/postgres";

export type PostgresContentAccessScope = "site" | "novel" | "video" | "audio" | "file";
export type ContentAccessScope = "all" | Exclude<PostgresContentAccessScope, "site">;
export type ContentAccessAudience = "all" | "guest";
export type ContentAccessCountryMode = "all" | "cn" | "non_cn";
export type ContentAccessTargetType = "ip" | "cidr" | "country" | "crawler";
export type ContentAccessMatchMode = "include" | "exclude";
export type ContentAccessRuleSource = "manual" | "rate_limit";
type StoredScope = ContentAccessScope;
type Audience = ContentAccessAudience;
type CountryMode = ContentAccessCountryMode;

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

export class ContentAccessInputError extends Error {}

export type PostgresContentAccessResult =
  | { allowed: true }
  | { allowed: false; message: string; status: 403 | 429; retryAfterSeconds?: number };

type AccessRuleRow = QueryResultRow & {
  id: string;
  target_type: "ip" | "cidr" | "country" | "crawler";
  target_value: string;
  match_mode: "include" | "exclude";
  scope: StoredScope;
  country_mode: CountryMode;
  audience: Audience;
  source: "manual" | "rate_limit";
  reason: string;
  expires_at: Date | string | null;
};

type AccessPolicyRow = QueryResultRow & {
  id: string;
  name: string;
  scope: StoredScope;
  country_mode: CountryMode;
  audience: Audience;
  window_seconds: number;
  max_requests: number;
  block_seconds: number;
};

type RateBucketRow = QueryResultRow & {
  request_count: number;
  window_expires_at: Date | string;
  blocked_until: Date | string | null;
};

export type PostgresContentAccessControlState = Readonly<{
  global: boolean;
  novel: boolean;
}>;

type ControlStateCache = {
  value?: PostgresContentAccessControlState;
  expiresAt?: number;
  pending?: Promise<PostgresContentAccessControlState>;
};

const controlState = globalThis as typeof globalThis & { postgresContentAccessControlState?: ControlStateCache };
const CONTROL_STATE_TTL_MS = 2_000;

/** One tiny cached query keeps middleware free of embedded-database reads while
 * avoiding an extra round trip on every public asset/document request. */
export async function readPostgresContentAccessControlState(
  executor: SqlExecutor,
  options: { fresh?: boolean; now?: number } = {},
): Promise<PostgresContentAccessControlState> {
  const now = options.now ?? Date.now();
  controlState.postgresContentAccessControlState ||= {};
  const cache = controlState.postgresContentAccessControlState;
  if (!options.fresh && cache.value && (cache.expiresAt ?? 0) > now) return cache.value;
  if (!options.fresh && cache.pending) return cache.pending;
  const pending = executor.query<QueryResultRow & { global: boolean; novel: boolean }>({
    name: "access-control-state-v1",
    text: `SELECT
      EXISTS (
        SELECT 1 FROM content_access_rules
        WHERE enabled = TRUE AND scope = 'all'
          AND (expires_at IS NULL OR expires_at > clock_timestamp())
      ) AS global,
      (
        EXISTS (
          SELECT 1 FROM content_access_rules
          WHERE enabled = TRUE AND scope IN ('all', 'novel')
            AND (expires_at IS NULL OR expires_at > clock_timestamp())
        ) OR EXISTS (
          SELECT 1 FROM content_access_policies
          WHERE enabled = TRUE AND scope IN ('all', 'novel')
        )
      ) AS novel`,
  }).then((result) => {
    const row = result.rows[0];
    const value = Object.freeze({ global: row?.global === true, novel: row?.novel === true });
    cache.value = value;
    cache.expiresAt = now + CONTROL_STATE_TTL_MS;
    return value;
  }).finally(() => {
    if (cache.pending === pending) cache.pending = undefined;
  });
  if (!options.fresh) cache.pending = pending;
  return pending;
}

export function invalidatePostgresContentAccessControlState(): void {
  delete controlState.postgresContentAccessControlState;
  ruleCacheGeneration += 1;
}

type RuleCacheEntry = {
  generation: number;
  expiresAt: number;
  rows: Promise<AccessRuleRow[]>;
};

const RULE_CACHE_TTL_MS = 2_000;
const ruleCaches = new WeakMap<SqlExecutor, Map<string, RuleCacheEntry>>();
let ruleCacheGeneration = 0;

/** Enabled rules change only through the admin mutations in this module, which
 * bump the generation; the TTL bounds staleness across instances. Expiry is
 * re-checked against the caller's clock on every read. */
function readActiveAccessRules(executor: SqlExecutor, storedScope: string, now: Date): Promise<AccessRuleRow[]> {
  let cache = ruleCaches.get(executor);
  if (!cache) {
    cache = new Map();
    ruleCaches.set(executor, cache);
  }
  const clock = Date.now();
  const cached = cache.get(storedScope);
  if (cached && cached.generation === ruleCacheGeneration && cached.expiresAt > clock) {
    return cached.rows.then((rows) => rows.filter((rule) => !rule.expires_at || instant(rule.expires_at) > now.getTime()));
  }
  const rows = executor.query<AccessRuleRow>({
    text: `SELECT id, target_type, target_value, match_mode, scope, country_mode, audience, source, reason, expires_at
      FROM content_access_rules
      WHERE enabled = TRUE AND (expires_at IS NULL OR expires_at > $1::timestamptz)
        AND (scope = 'all' OR scope = $2)
      ORDER BY CASE source WHEN 'manual' THEN 0 ELSE 1 END, id ASC`,
    values: [now.toISOString(), storedScope],
  }).then((result) => result.rows);
  const entry: RuleCacheEntry = { generation: ruleCacheGeneration, expiresAt: clock + RULE_CACHE_TTL_MS, rows };
  const scopedCache = cache;
  scopedCache.set(storedScope, entry);
  rows.catch(() => {
    if (scopedCache.get(storedScope) === entry) scopedCache.delete(storedScope);
  });
  return rows;
}

const CRAWLER_PATTERN = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|bytespider|yandex|baiduspider|sogou/iu;
const HEADLESS_PATTERN = /headless|phantom|selenium|playwright|puppeteer/iu;

function scopeMatches(configured: StoredScope, requested: PostgresContentAccessScope): boolean {
  return configured === "all" || (requested !== "site" && configured === requested);
}

function audienceMatches(configured: Audience, authenticated: boolean): boolean {
  return configured === "all" || !authenticated;
}

function countryMatches(configured: CountryMode, country: string): boolean {
  if (configured === "all") return true;
  if (country === "unknown") return false;
  return configured === "cn" ? country === "CN" : country !== "CN";
}

function addressVariants(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u);
  return mapped && isIP(mapped[1]) === 4 ? [normalized, mapped[1]] : [normalized];
}

function ipType(family: 4 | 6): "ipv4" | "ipv6" {
  return family === 4 ? "ipv4" : "ipv6";
}

function matchesIp(ip: string, target: string): boolean {
  const [base, prefixText, extra] = target.toLowerCase().split("/");
  if (prefixText !== undefined) {
    const family = isIP(base || "");
    const prefix = Number(prefixText);
    if (extra !== undefined || (family !== 4 && family !== 6) || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
      return false;
    }
    const list = new BlockList();
    list.addSubnet(base, prefix, ipType(family));
    return addressVariants(ip).some((candidate) => isIP(candidate) === family && list.check(candidate, ipType(family)));
  }
  return addressVariants(ip).some((candidate) => addressVariants(target).includes(candidate));
}

function crawlerMatches(target: string, userAgent: string): boolean {
  if (target === "crawler") return CRAWLER_PATTERN.test(userAgent);
  if (target === "headless") return HEADLESS_PATTERN.test(userAgent);
  return CRAWLER_PATTERN.test(userAgent) || HEADLESS_PATTERN.test(userAgent);
}

export function postgresAccessRuleMatches(
  rule: AccessRuleRow,
  context: { ip: string; country: string; userAgent: string; scope: PostgresContentAccessScope; authenticated: boolean },
): boolean {
  if (!scopeMatches(rule.scope, context.scope) || !audienceMatches(rule.audience, context.authenticated) ||
      !countryMatches(rule.country_mode, context.country)) return false;
  if (rule.target_type === "country") {
    const found = rule.target_value.split(",").includes(context.country);
    return rule.match_mode === "exclude" ? !found : found;
  }
  if (rule.target_type === "crawler") return crawlerMatches(rule.target_value, context.userAgent);
  return isIP(context.ip) !== 0 && matchesIp(context.ip, rule.target_value);
}

function positiveInteger(value: number, fallback: number, maximum: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
}

function instant(value: Date | string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("PostgreSQL content access returned an invalid timestamp");
  return timestamp;
}

async function consumeRateLimit(
  executor: SqlExecutor,
  policy: AccessPolicyRow,
  identityHash: string,
  now: Date,
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowSeconds = positiveInteger(policy.window_seconds, 60, 86_400);
  const maximum = positiveInteger(policy.max_requests, 60, 1_000_000);
  const blockSeconds = positiveInteger(policy.block_seconds, 60, 86_400);
  const result = await executor.query<RateBucketRow>({
    text: `INSERT INTO content_access_rate_buckets
      (policy_id, identity_hash, window_started_at, window_expires_at, request_count, blocked_until)
      VALUES ($1::bigint, $2, $3::timestamptz, $3::timestamptz + ($4::integer * interval '1 second'), 1, NULL)
      ON CONFLICT (policy_id, identity_hash) DO UPDATE SET
        window_started_at = CASE WHEN content_access_rate_buckets.window_expires_at <= $3 THEN $3 ELSE content_access_rate_buckets.window_started_at END,
        window_expires_at = CASE WHEN content_access_rate_buckets.window_expires_at <= $3 THEN $3::timestamptz + ($4::integer * interval '1 second') ELSE content_access_rate_buckets.window_expires_at END,
        request_count = CASE WHEN content_access_rate_buckets.window_expires_at <= $3 THEN 1 ELSE least(content_access_rate_buckets.request_count + 1::bigint, 2147483647)::integer END,
        blocked_until = CASE
          WHEN content_access_rate_buckets.blocked_until > $3 THEN content_access_rate_buckets.blocked_until
          WHEN content_access_rate_buckets.window_expires_at <= $3 THEN NULL
          WHEN content_access_rate_buckets.request_count >= $5 THEN $3::timestamptz + ($6::integer * interval '1 second')
          ELSE NULL
        END
      RETURNING request_count, window_expires_at, blocked_until`,
    values: [policy.id, identityHash, now.toISOString(), windowSeconds, maximum, blockSeconds],
  });
  const bucket = result.rows[0];
  if (!bucket) throw new Error("PostgreSQL content rate limit did not return a bucket");
  const blockedUntil = bucket.blocked_until ? instant(bucket.blocked_until) : 0;
  if (blockedUntil > now.getTime() || bucket.request_count > maximum) {
    const until = Math.max(blockedUntil, instant(bucket.window_expires_at));
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((until - now.getTime()) / 1_000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function checkPostgresContentAccess(
  executor: SqlExecutor,
  headers: HeaderReader,
  options: {
    scope?: PostgresContentAccessScope;
    authenticated?: boolean;
    admin?: boolean;
    rateLimit?: boolean;
    now?: Date;
  } = {},
): Promise<PostgresContentAccessResult> {
  if (options.admin) return { allowed: true };
  const now = options.now ?? new Date();
  const scope = options.scope ?? "novel";
  const authenticated = options.authenticated === true;
  const address = getTrustedClientAddress(headers);
  const context = {
    ip: address.ip,
    country: address.country,
    userAgent: headers.get("user-agent") || "",
    scope,
    authenticated,
  };
  const rules = await readActiveAccessRules(executor, scope === "site" ? "all" : scope, now);
  const blocked = rules.find((rule) => postgresAccessRuleMatches(rule, context));
  if (blocked) {
    const expiry = blocked.expires_at ? instant(blocked.expires_at) : 0;
    const retryAfterSeconds = blocked.source === "rate_limit" && expiry > now.getTime()
      ? Math.max(1, Math.ceil((expiry - now.getTime()) / 1_000))
      : undefined;
    return {
      allowed: false,
      status: retryAfterSeconds ? 429 : 403,
      message: retryAfterSeconds ? `访问过于频繁，请 ${retryAfterSeconds} 秒后再试` : scope === "site" ? "当前网络暂不能访问本站" : "当前网络暂不能访问该内容",
      ...(retryAfterSeconds ? { retryAfterSeconds } : {}),
    };
  }
  if (options.rateLimit === false || !address.trusted || !isIP(address.ip)) return { allowed: true };
  const policies = await executor.query<AccessPolicyRow>({
    text: `SELECT id, name, scope, country_mode, audience, window_seconds, max_requests, block_seconds
      FROM content_access_policies
      WHERE enabled = TRUE AND (scope = 'all' OR scope = $1)
      ORDER BY id ASC`,
    values: [scope === "site" ? "all" : scope],
  });
  const identitySecret = process.env.RATE_LIMIT_IDENTITY_SECRET || process.env.TRUST_PROXY_SECRET || "";
  const identityHash = crypto.createHash("sha256").update(`${identitySecret}\0${address.ip}`).digest("hex");
  for (const policy of policies.rows) {
    if (!scopeMatches(policy.scope, scope) || !audienceMatches(policy.audience, authenticated) || !countryMatches(policy.country_mode, address.country)) continue;
    const rate = await consumeRateLimit(executor, policy, identityHash, now);
    if (!rate.allowed) return { allowed: false, status: 429, message: `访问过于频繁，请 ${rate.retryAfterSeconds} 秒后再试`, retryAfterSeconds: rate.retryAfterSeconds };
  }
  return { allowed: true };
}

export async function hasPostgresScopedContentAccessRules(
  executor: SqlExecutor,
  scope: Exclude<PostgresContentAccessScope, "site">,
  now = new Date(),
): Promise<boolean> {
  const result = await executor.query<QueryResultRow & { configured: boolean }>({
    name: "access-has-scoped-rules-v1",
    text: `SELECT EXISTS (
      SELECT 1 FROM content_access_rules
      WHERE enabled = true AND (expires_at IS NULL OR expires_at > $1)
        AND (scope = 'all' OR scope = $2)
    ) AS configured`,
    values: [now, scope],
  });
  return result.rows[0]?.configured === true;
}

type AdminRuleRow = QueryResultRow & {
  id: string | number;
  target_type: ContentAccessTargetType;
  target_value: string;
  match_mode: ContentAccessMatchMode;
  scope: ContentAccessScope;
  country_mode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  source: ContentAccessRuleSource;
  reason: string;
  expires_at: Date | string | null;
  enabled: boolean;
  created_by: string;
  created_at: Date | string;
  updated_at: Date | string;
};

type AdminPolicyRow = QueryResultRow & {
  id: string | number;
  name: string;
  enabled: boolean;
  scope: ContentAccessScope;
  country_mode: ContentAccessCountryMode;
  audience: ContentAccessAudience;
  window_seconds: number;
  max_requests: number;
  block_seconds: number;
  created_at: Date | string;
  updated_at: Date | string;
};

const ADMIN_RULE_COLUMNS = `id, target_type, target_value, match_mode, scope, country_mode,
  audience, source, reason, expires_at, enabled, created_by, created_at, updated_at`;
const ADMIN_POLICY_COLUMNS = `id, name, enabled, scope, country_mode, audience,
  window_seconds, max_requests, block_seconds, created_at, updated_at`;

function adminId(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new ContentAccessInputError(`无效的${name}`);
  return parsed;
}

function adminTimestamp(value: Date | string, name: string): { iso: string; milliseconds: number } {
  const date = value instanceof Date ? value : new Date(value);
  const milliseconds = date.getTime();
  if (!Number.isFinite(milliseconds)) throw new Error(`Invalid PostgreSQL ${name} timestamp`);
  return { iso: date.toISOString(), milliseconds };
}

function toAdminRule(row: AdminRuleRow): ContentAccessRule {
  return {
    id: adminId(row.id, "访问规则"),
    targetType: row.target_type,
    targetValue: row.target_value,
    matchMode: row.match_mode,
    scope: row.scope,
    countryMode: row.country_mode,
    audience: row.audience,
    source: row.source,
    reason: row.reason,
    expiresAt: row.expires_at === null ? null : adminTimestamp(row.expires_at, "access expiry").milliseconds,
    enabled: row.enabled === true,
    createdBy: row.created_by,
    createdAt: adminTimestamp(row.created_at, "access creation").iso,
    updatedAt: adminTimestamp(row.updated_at, "access update").iso,
  };
}

function toAdminPolicy(row: AdminPolicyRow): ContentAccessPolicy {
  return {
    id: adminId(row.id, "访问策略"),
    name: row.name,
    enabled: row.enabled === true,
    scope: row.scope,
    countryMode: row.country_mode,
    audience: row.audience,
    windowSeconds: row.window_seconds,
    maxRequests: row.max_requests,
    blockSeconds: row.block_seconds,
    createdAt: adminTimestamp(row.created_at, "policy creation").iso,
    updatedAt: adminTimestamp(row.updated_at, "policy update").iso,
  };
}

function normalizedScope(value: unknown): ContentAccessScope {
  if (value === "novel" || value === "video" || value === "audio" || value === "file") return value;
  return "all";
}

function normalizedCountryMode(value: unknown): ContentAccessCountryMode {
  return value === "cn" || value === "non_cn" ? value : "all";
}

function normalizedAudience(value: unknown, fallback: ContentAccessAudience): ContentAccessAudience {
  return value === "all" || value === "guest" ? value : fallback;
}

function normalizedTargetType(value: unknown): ContentAccessTargetType {
  return value === "cidr" || value === "country" || value === "crawler" ? value : "ip";
}

function normalizedTargetValue(type: ContentAccessTargetType, value: unknown): string {
  const text = String(value || "").trim();
  if (type === "crawler") return text === "crawler" || text === "headless" ? text : "all";
  if (type === "ip") {
    if (!isIP(text)) throw new ContentAccessInputError("请输入有效的 IPv4 或 IPv6 地址");
    return text.toLocaleLowerCase("en-US");
  }
  if (type === "cidr") {
    const [address, prefixText, extra] = text.split("/");
    const family = isIP(address || "");
    const prefix = Number(prefixText);
    if (extra !== undefined || (family !== 4 && family !== 6) || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
      throw new ContentAccessInputError("请输入有效的 CIDR 网段");
    }
    return `${address.toLocaleLowerCase("en-US")}/${prefix}`;
  }
  const countries = [...new Set(text.split(/[\s,，、]+/u).map((item) => item.trim().toUpperCase()).filter(Boolean))];
  if (!countries.length || countries.length > 32 || countries.some((country) => !/^(?:[A-Z]{2}|T1)$/u.test(country))) {
    throw new ContentAccessInputError("请选择 1 至 32 个有效国家代码");
  }
  return countries.sort().join(",");
}

function boundedAdminInteger(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(Math.floor(parsed), minimum), maximum) : fallback;
}

export async function listPostgresContentAccessRules(executor: SqlExecutor, limitValue = 300): Promise<ContentAccessRule[]> {
  const limit = boundedAdminInteger(limitValue, 300, 1, 1_000);
  const result = await executor.query<AdminRuleRow>({
    text: `SELECT ${ADMIN_RULE_COLUMNS} FROM content_access_rules
      WHERE source = 'manual' OR expires_at IS NULL OR expires_at > clock_timestamp()
      ORDER BY enabled DESC, source ASC, expires_at DESC NULLS FIRST, id DESC LIMIT $1`,
    values: [limit],
  });
  return result.rows.map(toAdminRule);
}

export async function savePostgresContentAccessRule(executor: SqlExecutor, input: {
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
}): Promise<ContentAccessRule> {
  const id = input.id ? adminId(input.id, "访问规则") : null;
  const targetType = normalizedTargetType(input.targetType);
  const targetValue = normalizedTargetValue(targetType, input.targetValue);
  const matchMode: ContentAccessMatchMode = targetType === "country" && input.matchMode === "exclude" ? "exclude" : "include";
  const expiry = input.expiresAt && input.expiresAt > Date.now() ? new Date(Math.floor(input.expiresAt)).toISOString() : null;
  const values = [targetType, targetValue, matchMode, normalizedScope(input.scope), normalizedCountryMode(input.countryMode),
    normalizedAudience(input.audience, "all"), String(input.reason || "").trim().slice(0, 120), expiry, input.enabled !== false];
  const result = id === null
    ? await executor.query<AdminRuleRow>({
        text: `INSERT INTO content_access_rules
          (target_type, target_value, match_mode, scope, country_mode, audience, source, reason, expires_at, enabled, created_by)
          VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7, $8, $9, $10)
          RETURNING ${ADMIN_RULE_COLUMNS}`,
        values: [...values, String(input.createdBy || "").trim().slice(0, 64)],
      })
    : await executor.query<AdminRuleRow>({
        text: `UPDATE content_access_rules SET target_type = $1, target_value = $2, match_mode = $3,
          scope = $4, country_mode = $5, audience = $6, reason = $7, expires_at = $8,
          enabled = $9, updated_at = clock_timestamp()
          WHERE id = $10 AND source = 'manual' RETURNING ${ADMIN_RULE_COLUMNS}`,
        values: [...values, id],
      });
  const row = result.rows[0];
  if (!row) throw new ContentAccessInputError("访问规则不存在或不可编辑");
  invalidatePostgresContentAccessControlState();
  return toAdminRule(row);
}

export async function deletePostgresContentAccessRule(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({ text: "DELETE FROM content_access_rules WHERE id = $1", values: [adminId(idValue, "访问规则")] });
  if (result.rowCount) invalidatePostgresContentAccessControlState();
  return result.rowCount === 1;
}

export async function listPostgresContentAccessPolicies(executor: SqlExecutor): Promise<ContentAccessPolicy[]> {
  const result = await executor.query<AdminPolicyRow>({
    name: "access-admin-policies-v1",
    text: `SELECT ${ADMIN_POLICY_COLUMNS} FROM content_access_policies ORDER BY id ASC`,
  });
  return result.rows.map(toAdminPolicy);
}

export async function savePostgresContentAccessPolicy(executor: SqlExecutor, input: {
  id?: number;
  name?: unknown;
  enabled?: boolean;
  scope?: unknown;
  countryMode?: unknown;
  audience?: unknown;
  windowSeconds?: unknown;
  maxRequests?: unknown;
  blockSeconds?: unknown;
}): Promise<ContentAccessPolicy> {
  const id = input.id ? adminId(input.id, "访问策略") : null;
  const values = [String(input.name || "内容访问保护").trim().slice(0, 40) || "内容访问保护", input.enabled !== false,
    normalizedScope(input.scope), normalizedCountryMode(input.countryMode), normalizedAudience(input.audience, "guest"),
    boundedAdminInteger(input.windowSeconds, 60, 1, 86_400), boundedAdminInteger(input.maxRequests, 60, 1, 100_000),
    boundedAdminInteger(input.blockSeconds, 300, 60, 31_536_000)];
  const result = id === null
    ? await executor.query<AdminPolicyRow>({
        text: `INSERT INTO content_access_policies
          (name, enabled, scope, country_mode, audience, window_seconds, max_requests, block_seconds)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${ADMIN_POLICY_COLUMNS}`,
        values,
      })
    : await executor.query<AdminPolicyRow>({
        text: `UPDATE content_access_policies SET name = $1, enabled = $2, scope = $3, country_mode = $4,
          audience = $5, window_seconds = $6, max_requests = $7, block_seconds = $8,
          updated_at = clock_timestamp() WHERE id = $9 RETURNING ${ADMIN_POLICY_COLUMNS}`,
        values: [...values, id],
      });
  const row = result.rows[0];
  if (!row) throw new ContentAccessInputError("访问频率规则不存在");
  invalidatePostgresContentAccessControlState();
  return toAdminPolicy(row);
}

export async function deletePostgresContentAccessPolicy(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({ text: "DELETE FROM content_access_policies WHERE id = $1", values: [adminId(idValue, "访问策略")] });
  if (result.rowCount) invalidatePostgresContentAccessControlState();
  return result.rowCount === 1;
}
