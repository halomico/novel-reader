import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import {
  checkPostgresContentAccess,
  invalidatePostgresContentAccessControlState,
  listPostgresContentAccessPolicies,
  listPostgresContentAccessRules,
  postgresAccessRuleMatches,
  readPostgresContentAccessControlState,
  savePostgresContentAccessPolicy,
  savePostgresContentAccessRule,
} from "./postgres-content-access";

function rule(overrides: Partial<QueryResultRow> = {}) {
  return {
    id: "1", target_type: "ip", target_value: "203.0.113.0/24", match_mode: "include",
    scope: "novel", country_mode: "all", audience: "all", source: "manual", reason: "", expires_at: null,
    ...overrides,
  } as Parameters<typeof postgresAccessRuleMatches>[0];
}

const context = { ip: "203.0.113.8", country: "CN", userAgent: "Mozilla/5.0", scope: "novel", authenticated: false } as const;

test("PostgreSQL access rules match CIDR, scope and audience", () => {
  assert.equal(postgresAccessRuleMatches(rule(), context), true);
  assert.equal(postgresAccessRuleMatches(rule({ target_value: "198.51.100.0/24" }), context), false);
  assert.equal(postgresAccessRuleMatches(rule({ scope: "video" }), context), false);
  assert.equal(postgresAccessRuleMatches(rule({ audience: "guest" }), { ...context, authenticated: true }), false);
});

test("PostgreSQL access rules preserve country exclusion and crawler policies", () => {
  assert.equal(postgresAccessRuleMatches(rule({ target_type: "country", target_value: "US,DE", match_mode: "exclude" }), context), true);
  assert.equal(postgresAccessRuleMatches(rule({ target_type: "country", target_value: "CN", match_mode: "exclude" }), context), false);
  assert.equal(postgresAccessRuleMatches(rule({ target_type: "crawler", target_value: "crawler" }), { ...context, userAgent: "ExampleBot/1.0" }), true);
});

test("middleware control discovery is one cached PostgreSQL query", async () => {
  invalidatePostgresContentAccessControlState();
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      queries.push(query);
      return {
        command: "SELECT", rowCount: 1, oid: 0, fields: [],
        rows: [{ global: false, novel: true }],
      } as unknown as QueryResult<Row>;
    },
  };
  assert.deepEqual(await readPostgresContentAccessControlState(executor, { now: 10 }), { global: false, novel: true });
  assert.deepEqual(await readPostgresContentAccessControlState(executor, { now: 11 }), { global: false, novel: true });
  assert.equal(queries.length, 1);
  assert.match(queries[0].text, /content_access_rules/);
  assert.match(queries[0].text, /content_access_policies/);
  invalidatePostgresContentAccessControlState();
});

const adminRule = {
  id: "8", target_type: "cidr", target_value: "203.0.113.0/24", match_mode: "include",
  scope: "novel", country_mode: "all", audience: "guest", source: "manual", reason: "test",
  expires_at: null, enabled: true, created_by: "admin",
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
};
const adminPolicy = {
  id: "3", name: "阅读保护", enabled: true, scope: "novel", country_mode: "all", audience: "guest",
  window_seconds: 60, max_requests: 120, block_seconds: 300,
  created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z",
};

test("admin access rules and policies read typed PostgreSQL models", async () => {
  const rows = async <Row extends QueryResultRow>(values: QueryResultRow[]) => ({
    command: "SELECT", rowCount: values.length, oid: 0, fields: [], rows: values,
  } as unknown as QueryResult<Row>);
  const ruleExecutor: SqlExecutor = { query: () => rows([adminRule]) };
  const policyExecutor: SqlExecutor = { query: () => rows([adminPolicy]) };
  assert.equal((await listPostgresContentAccessRules(ruleExecutor))[0].id, 8);
  assert.equal((await listPostgresContentAccessPolicies(policyExecutor))[0].maxRequests, 120);
});

test("admin access mutations bind normalized values and invalidate middleware discovery", async () => {
  const captured: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const values = query.text.includes("content_access_policies") ? [adminPolicy] : [adminRule];
      return { command: "INSERT", rowCount: 1, oid: 0, fields: [], rows: values } as unknown as QueryResult<Row>;
    },
  };
  await savePostgresContentAccessRule(executor, {
    targetType: "cidr", targetValue: "203.0.113.0/24", scope: "novel", audience: "guest", createdBy: "admin",
  });
  assert.match(captured[0].text, /INSERT INTO content_access_rules/);
  assert.equal(captured[0].values?.[1], "203.0.113.0/24");
  await savePostgresContentAccessPolicy(executor, { name: "阅读保护", scope: "novel", maxRequests: 120 });
  assert.match(captured[1].text, /INSERT INTO content_access_policies/);
  await assert.rejects(savePostgresContentAccessRule(executor, { targetType: "cidr", targetValue: "bad" }), /CIDR/);
});

test("distributed PostgreSQL rate limits use one atomic upsert and return Retry-After", async (t) => {
  const previousMode = process.env.TRUST_PROXY_MODE;
  const previousSecret = process.env.TRUST_PROXY_SECRET;
  process.env.TRUST_PROXY_MODE = "signed";
  process.env.TRUST_PROXY_SECRET = "s".repeat(32);
  t.after(() => {
    if (previousMode === undefined) delete process.env.TRUST_PROXY_MODE; else process.env.TRUST_PROXY_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.TRUST_PROXY_SECRET; else process.env.TRUST_PROXY_SECRET = previousSecret;
  });
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(sql: SqlQuery) {
      queries.push(sql);
      const rows = queries.length === 1
        ? []
        : queries.length === 2
          ? [{ id: "4", name: "search", scope: "novel", country_mode: "all", audience: "all", window_seconds: 60, max_requests: 2, block_seconds: 30 }]
          : [{ request_count: 3, window_expires_at: "2026-09-07T00:01:00.000Z", blocked_until: "2026-09-07T00:00:30.000Z" }];
      return { command: "SELECT", rowCount: rows.length, oid: 0, fields: [], rows } as unknown as QueryResult<Row>;
    },
  };
  const headers = new Headers({
    "x-novel-proxy-secret": "s".repeat(32),
    "x-novel-client-ip": "203.0.113.9",
    "user-agent": "Mozilla/5.0",
  });
  const result = await checkPostgresContentAccess(executor, headers, {
    scope: "novel",
    now: new Date("2026-09-07T00:00:00.000Z"),
  });
  assert.deepEqual(result, { allowed: false, status: 429, message: "访问过于频繁，请 60 秒后再试", retryAfterSeconds: 60 });
  assert.match(queries[2].text, /ON CONFLICT \(policy_id, identity_hash\) DO UPDATE/u);
  assert.match(String(queries[2].values?.[1]), /^[0-9a-f]{64}$/u);
  assert.equal(String(queries[2].values?.[1]).includes("203.0.113.9"), false);
});

test("a content check with no policy configured reads cached lists and meters nothing", async (t) => {
  const previousMode = process.env.TRUST_PROXY_MODE;
  const previousSecret = process.env.TRUST_PROXY_SECRET;
  process.env.TRUST_PROXY_MODE = "signed";
  process.env.TRUST_PROXY_SECRET = "s".repeat(32);
  t.after(() => {
    if (previousMode === undefined) delete process.env.TRUST_PROXY_MODE; else process.env.TRUST_PROXY_MODE = previousMode;
    if (previousSecret === undefined) delete process.env.TRUST_PROXY_SECRET; else process.env.TRUST_PROXY_SECRET = previousSecret;
  });
  const queries: SqlQuery[] = [];
  const executor: SqlExecutor = {
    async query<Row extends QueryResultRow>(sql: SqlQuery) {
      queries.push(sql);
      return { command: "SELECT", rowCount: 0, oid: 0, fields: [], rows: [] } as unknown as QueryResult<Row>;
    },
  };
  const headers = new Headers({
    "x-novel-proxy-secret": "s".repeat(32),
    "x-novel-client-ip": "203.0.113.9",
    "user-agent": "Mozilla/5.0",
  });
  const now = new Date("2026-09-07T00:00:00.000Z");
  assert.deepEqual(await checkPostgresContentAccess(executor, headers, { scope: "novel", now }), { allowed: true });
  assert.deepEqual(queries.map((query) => /content_access_(rules|policies)/u.exec(query.text)?.[1]), ["rules", "policies"]);

  // Every book page and chapter page runs this guard, so the lists it needs are read once
  // per executor and reused: a second visit inside the TTL must add no round trip, and an
  // unconfigured site must never touch a rate bucket.
  assert.deepEqual(await checkPostgresContentAccess(executor, headers, { scope: "novel", now }), { allowed: true });
  assert.equal(queries.length, 2);
  assert.ok(queries.every((query) => !query.text.includes("content_access_rate_buckets")));
});
