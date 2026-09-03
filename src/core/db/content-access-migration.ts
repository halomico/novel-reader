import { isIP } from "node:net";
import type { DatabaseSync } from "node:sqlite";

const MIGRATION_VERSION = 2026090401;
const MIGRATION_NAME = "preserve-legacy-content-access-rules";
const MIGRATION_CHECKSUM = "sha256:95529acd52bb4a79e498ee5113044a3c9f6747d63b8114ac64f46586705264c7";

const RULE_COLUMNS = [
  "id",
  "target_type",
  "target_value",
  "match_mode",
  "scope",
  "country_mode",
  "audience",
  "source",
  "reason",
  "expires_at",
  "enabled",
  "created_by",
  "created_at",
  "updated_at",
] as const;

const POLICY_COLUMNS = [
  "id",
  "name",
  "enabled",
  "scope",
  "country_mode",
  "audience",
  "window_seconds",
  "max_requests",
  "block_seconds",
  "created_at",
  "updated_at",
] as const;

type LegacyRow = Record<string, unknown>;

type RuleValue = {
  id: number | null;
  targetType: "ip" | "cidr" | "country" | "crawler";
  targetValue: string;
  matchMode: "include" | "exclude";
  scope: "all" | "novel" | "video" | "audio" | "file";
  countryMode: "all" | "cn" | "non_cn";
  audience: "all" | "guest";
  source: "manual" | "rate_limit";
  reason: string;
  expiresAt: number | null;
  enabled: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type PolicyValue = {
  id: number | null;
  name: string;
  enabled: number;
  scope: "all" | "novel" | "video" | "audio" | "file";
  countryMode: "all" | "cn" | "non_cn";
  audience: "all" | "guest";
  windowSeconds: number;
  maxRequests: number;
  blockSeconds: number;
  createdAt: string;
  updatedAt: string;
};

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare(
    "SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(name));
}

function tableColumns(db: DatabaseSync, name: string): Set<string> {
  if (!tableExists(db, name)) return new Set();
  return new Set((db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((row) => row.name));
}

function tableIsCurrent(db: DatabaseSync, name: string, expected: readonly string[]): boolean {
  const columns = tableColumns(db, name);
  return expected.every((column) => columns.has(column));
}

function first(row: LegacyRow, names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && row[name] !== undefined) return row[name];
  }
  return undefined;
}

function cleanText(value: unknown, fallback = "", max = 500): string {
  const text = String(value ?? fallback).trim();
  return (text || fallback).slice(0, max);
}

function cleanInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), min), max);
}

function cleanTimestamp(value: unknown): string {
  const text = cleanText(value, "", 80);
  return text || new Date().toISOString();
}

function normalizeScope(value: unknown): Array<RuleValue["scope"]> {
  const scope = cleanText(value, "all", 30).toLowerCase();
  if (scope === "media") return ["video", "audio", "file"];
  if (scope === "book" || scope === "books") return ["novel"];
  if (scope === "video" || scope === "audio" || scope === "file" || scope === "novel") return [scope];
  return ["all"];
}

function normalizeTarget(row: LegacyRow): Pick<RuleValue, "targetType" | "targetValue"> {
  const rawValue = cleanText(first(row, ["target_value", "value", "target", "ip", "network"]), "", 500);
  let rawType = cleanText(first(row, ["target_type", "type", "rule_type"]), "", 30).toLowerCase();
  if (!rawType) {
    if (rawValue.includes("/")) rawType = "cidr";
    else if (isIP(rawValue)) rawType = "ip";
    else if (/^(?:[A-Za-z]{2}|T1)(?:\s*[,，、]\s*(?:[A-Za-z]{2}|T1))*$/.test(rawValue)) rawType = "country";
    else rawType = "crawler";
  }

  if (rawType === "bot" || rawType === "user_agent") rawType = "crawler";
  if (rawType === "network") rawType = rawValue.includes("/") ? "cidr" : "ip";
  if (!["ip", "cidr", "country", "crawler"].includes(rawType)) {
    throw new Error(`Unsupported legacy content-access target type: ${rawType || "empty"}`);
  }

  const targetType = rawType as RuleValue["targetType"];
  if (!rawValue) throw new Error(`Legacy ${targetType} rule has no target value`);
  if (targetType === "ip" && !isIP(rawValue)) throw new Error(`Invalid legacy IP rule: ${rawValue}`);
  if (targetType === "cidr") {
    const [address, prefixText, extra] = rawValue.split("/");
    const family = isIP(address || "");
    const prefix = Number(prefixText);
    if (extra !== undefined || !family || !Number.isInteger(prefix) || prefix < 0 || prefix > (family === 4 ? 32 : 128)) {
      throw new Error(`Invalid legacy CIDR rule: ${rawValue}`);
    }
  }

  const targetValue = targetType === "country"
    ? rawValue.split(/[\s,，、]+/u).filter(Boolean).map((part) => part.toUpperCase()).sort().join(",")
    : rawValue.toLowerCase();
  return { targetType, targetValue };
}

function normalizeRule(row: LegacyRow): RuleValue[] {
  const target = normalizeTarget(row);
  const scopes = normalizeScope(first(row, ["scope", "content_scope", "resource_type"]));
  const matchMode = cleanText(first(row, ["match_mode", "mode"]), "include", 20).toLowerCase() === "exclude"
    ? "exclude"
    : "include";
  const countryRaw = cleanText(first(row, ["country_mode", "region_mode"]), "all", 20).toLowerCase();
  const countryMode = countryRaw === "cn" || countryRaw === "non_cn" ? countryRaw : "all";
  const audience = cleanText(first(row, ["audience", "user_scope"]), "all", 20).toLowerCase() === "guest"
    ? "guest"
    : "all";
  const source = cleanText(first(row, ["source"]), "manual", 30).toLowerCase() === "rate_limit"
    ? "rate_limit"
    : "manual";
  const idValue = Number(first(row, ["id"]));
  const expiresValue = Number(first(row, ["expires_at", "blocked_until"]));
  const base: Omit<RuleValue, "scope" | "id"> = {
    ...target,
    matchMode,
    countryMode,
    audience,
    source,
    reason: cleanText(first(row, ["reason", "note"]), "", 500),
    expiresAt: Number.isFinite(expiresValue) && expiresValue > 0 ? Math.floor(expiresValue) : null,
    enabled: cleanInteger(first(row, ["enabled", "is_enabled", "active"]), 1, 0, 1),
    createdBy: cleanText(first(row, ["created_by", "actor"]), "migration", 120),
    createdAt: cleanTimestamp(first(row, ["created_at"])),
    updatedAt: cleanTimestamp(first(row, ["updated_at", "created_at"])),
  };
  return scopes.map((scope, index) => ({
    ...base,
    scope,
    id: scopes.length === 1 && Number.isSafeInteger(idValue) && idValue > 0 && index === 0 ? idValue : null,
  }));
}

function normalizePolicy(row: LegacyRow): PolicyValue[] {
  const scopes = normalizeScope(first(row, ["scope", "content_scope", "resource_type"]));
  const countryRaw = cleanText(first(row, ["country_mode", "region_mode"]), "all", 20).toLowerCase();
  const idValue = Number(first(row, ["id"]));
  const base: Omit<PolicyValue, "scope" | "id"> = {
    name: cleanText(first(row, ["name", "reason"]), "Legacy policy", 160),
    enabled: cleanInteger(first(row, ["enabled", "is_enabled", "active"]), 1, 0, 1),
    countryMode: countryRaw === "cn" || countryRaw === "non_cn" ? countryRaw : "all",
    audience: cleanText(first(row, ["audience", "user_scope"]), "guest", 20).toLowerCase() === "all"
      ? "all"
      : "guest",
    windowSeconds: cleanInteger(first(row, ["window_seconds", "window", "period_seconds"]), 60, 1, 86_400),
    maxRequests: cleanInteger(first(row, ["max_requests", "limit", "request_limit"]), 60, 1, 1_000_000),
    blockSeconds: cleanInteger(first(row, ["block_seconds", "ban_seconds", "duration_seconds"]), 3_600, 1, 31_536_000),
    createdAt: cleanTimestamp(first(row, ["created_at"])),
    updatedAt: cleanTimestamp(first(row, ["updated_at", "created_at"])),
  };
  return scopes.map((scope, index) => ({
    ...base,
    scope,
    id: scopes.length === 1 && Number.isSafeInteger(idValue) && idValue > 0 && index === 0 ? idValue : null,
  }));
}

function createCurrentTables(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE content_access_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK(target_type IN ('ip', 'cidr', 'country', 'crawler')),
      target_value TEXT NOT NULL,
      match_mode TEXT NOT NULL DEFAULT 'include' CHECK(match_mode IN ('include', 'exclude')),
      scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'video', 'audio', 'file')),
      country_mode TEXT NOT NULL DEFAULT 'all' CHECK(country_mode IN ('all', 'cn', 'non_cn')),
      audience TEXT NOT NULL DEFAULT 'all' CHECK(audience IN ('all', 'guest')),
      source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual', 'rate_limit')),
      reason TEXT NOT NULL DEFAULT '',
      expires_at INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      created_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE content_access_policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      scope TEXT NOT NULL DEFAULT 'all' CHECK(scope IN ('all', 'novel', 'video', 'audio', 'file')),
      country_mode TEXT NOT NULL DEFAULT 'all' CHECK(country_mode IN ('all', 'cn', 'non_cn')),
      audience TEXT NOT NULL DEFAULT 'guest' CHECK(audience IN ('all', 'guest')),
      window_seconds INTEGER NOT NULL CHECK(window_seconds > 0),
      max_requests INTEGER NOT NULL CHECK(max_requests > 0),
      block_seconds INTEGER NOT NULL CHECK(block_seconds > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function insertRule(db: DatabaseSync, rule: RuleValue): void {
  if (rule.id) {
    db.prepare(
      `INSERT INTO content_access_rules (
         id, target_type, target_value, match_mode, scope, country_mode, audience, source,
         reason, expires_at, enabled, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      rule.id, rule.targetType, rule.targetValue, rule.matchMode, rule.scope, rule.countryMode,
      rule.audience, rule.source, rule.reason, rule.expiresAt, rule.enabled, rule.createdBy,
      rule.createdAt, rule.updatedAt,
    );
    return;
  }
  db.prepare(
    `INSERT INTO content_access_rules (
       target_type, target_value, match_mode, scope, country_mode, audience, source,
       reason, expires_at, enabled, created_by, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    rule.targetType, rule.targetValue, rule.matchMode, rule.scope, rule.countryMode,
    rule.audience, rule.source, rule.reason, rule.expiresAt, rule.enabled, rule.createdBy,
    rule.createdAt, rule.updatedAt,
  );
}

function insertPolicy(db: DatabaseSync, policy: PolicyValue): void {
  const columns = policy.id
    ? "id, name, enabled, scope, country_mode, audience, window_seconds, max_requests, block_seconds, created_at, updated_at"
    : "name, enabled, scope, country_mode, audience, window_seconds, max_requests, block_seconds, created_at, updated_at";
  const placeholders = policy.id ? "?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?" : "?, ?, ?, ?, ?, ?, ?, ?, ?, ?";
  const values = [
    ...(policy.id ? [policy.id] : []),
    policy.name, policy.enabled, policy.scope, policy.countryMode, policy.audience,
    policy.windowSeconds, policy.maxRequests, policy.blockSeconds, policy.createdAt, policy.updatedAt,
  ];
  db.prepare(`INSERT INTO content_access_policies (${columns}) VALUES (${placeholders})`).run(...values);
}

function assertDatabaseIntegrity(db: DatabaseSync): void {
  const quick = db.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
  const values = quick.flatMap((row) => Object.values(row)).map(String);
  if (values.length !== 1 || values[0].toLowerCase() !== "ok") {
    throw new Error(`SQLite quick_check failed: ${values.join(", ") || "unknown"}`);
  }
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeys.length) throw new Error(`SQLite foreign_key_check found ${foreignKeys.length} violation(s)`);
}

/**
 * Migrates old content-access tables without ever discarding rows silently.
 * Any unconvertible row aborts the transaction and leaves the legacy schema untouched.
 */
export function migrateContentAccessSchemaSafe(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const applied = db.prepare("SELECT checksum FROM schema_migrations WHERE version = ?").get(MIGRATION_VERSION) as {
    checksum: string;
  } | undefined;
  if (applied) {
    if (applied.checksum !== MIGRATION_CHECKSUM) throw new Error(`Schema migration checksum mismatch for ${MIGRATION_VERSION}`);
    return;
  }

  const rulesCurrent = tableIsCurrent(db, "content_access_rules", RULE_COLUMNS);
  const policiesCurrent = tableIsCurrent(db, "content_access_policies", POLICY_COLUMNS);
  if (rulesCurrent && policiesCurrent) {
    db.prepare("INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)")
      .run(MIGRATION_VERSION, MIGRATION_NAME, MIGRATION_CHECKSUM);
    return;
  }

  const legacyRuleRows = tableExists(db, "content_access_rules")
    ? db.prepare("SELECT * FROM content_access_rules").all() as LegacyRow[]
    : [];
  const legacyPolicyRows = tableExists(db, "content_access_policies")
    ? db.prepare("SELECT * FROM content_access_policies").all() as LegacyRow[]
    : [];
  const convertedRules = legacyRuleRows.flatMap(normalizeRule);
  const convertedPolicies = legacyPolicyRows.flatMap(normalizePolicy);
  if (legacyRuleRows.length && convertedRules.length < legacyRuleRows.length) {
    throw new Error("Content-access rule migration would lose rows");
  }
  if (legacyPolicyRows.length && convertedPolicies.length < legacyPolicyRows.length) {
    throw new Error("Content-access policy migration would lose rows");
  }

  const rulesLegacyName = "content_access_rules_legacy_20260904";
  const policiesLegacyName = "content_access_policies_legacy_20260904";
  if (tableExists(db, rulesLegacyName) || tableExists(db, policiesLegacyName)) {
    throw new Error("A previous content-access migration requires manual recovery");
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    if (tableExists(db, "content_access_rules")) {
      db.exec(`ALTER TABLE content_access_rules RENAME TO ${rulesLegacyName}`);
    }
    if (tableExists(db, "content_access_policies")) {
      db.exec(`ALTER TABLE content_access_policies RENAME TO ${policiesLegacyName}`);
    }
    createCurrentTables(db);
    for (const rule of convertedRules) insertRule(db, rule);
    for (const policy of convertedPolicies) insertPolicy(db, policy);

    const ruleCount = (db.prepare("SELECT COUNT(*) AS count FROM content_access_rules").get() as { count: number }).count;
    const policyCount = (db.prepare("SELECT COUNT(*) AS count FROM content_access_policies").get() as { count: number }).count;
    if (ruleCount !== convertedRules.length || policyCount !== convertedPolicies.length) {
      throw new Error("Content-access migration row-count verification failed");
    }
    assertDatabaseIntegrity(db);
    if (tableExists(db, rulesLegacyName)) db.exec(`DROP TABLE ${rulesLegacyName}`);
    if (tableExists(db, policiesLegacyName)) db.exec(`DROP TABLE ${policiesLegacyName}`);
    db.prepare("INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)")
      .run(MIGRATION_VERSION, MIGRATION_NAME, MIGRATION_CHECKSUM);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
