import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkIpRateLimit,
  deleteIpRateLimitBan,
  ipRateLimitRuleApplies,
  listIpRateLimitBans,
  parseIpRateLimitBanKey,
} from "./ip-rate-limit";
import { normalizeIpRateLimitRules, type IpRateLimitRule } from "./site-settings";

const baseRule: IpRateLimitRule = {
  id: "base",
  enabled: true,
  scope: "all",
  queryType: "all",
  windowSeconds: 60,
  maxRequests: 30,
  banMode: "none",
  banSeconds: 3_600,
};

test("normalizes shared IP rate limit rules and keeps ids unique", () => {
  const rules = normalizeIpRateLimitRules([
    { ...baseRule, id: "same", windowSeconds: 0, maxRequests: 0 },
    { ...baseRule, id: "same", banMode: "temporary", banSeconds: 1 },
  ]);

  assert.equal(rules.length, 2);
  assert.equal(rules[0].id, "same");
  assert.equal(rules[1].id, "same-2");
  assert.equal(rules[0].windowSeconds, 1);
  assert.equal(rules[0].maxRequests, 1);
  assert.equal(rules[1].banSeconds, 60);
});

test("applies enabled IP rules by login and query type", () => {
  assert.equal(ipRateLimitRuleApplies(baseRule, { authenticated: false, shortQuery: false }), true);
  assert.equal(ipRateLimitRuleApplies({ ...baseRule, scope: "guest" }, { authenticated: true, shortQuery: false }), false);
  assert.equal(ipRateLimitRuleApplies({ ...baseRule, scope: "user" }, { authenticated: false, shortQuery: false }), false);
  assert.equal(ipRateLimitRuleApplies({ ...baseRule, queryType: "short" }, { authenticated: false, shortQuery: false }), false);
  assert.equal(ipRateLimitRuleApplies({ ...baseRule, enabled: false }, { authenticated: false, shortQuery: true }), false);
});

test("content-style rules apply without search context", () => {
  assert.equal(ipRateLimitRuleApplies(baseRule, {}), true);
  assert.equal(ipRateLimitRuleApplies({ ...baseRule, queryType: "short" }, {}), false);
});

test("parses only valid search and content ban keys", () => {
  assert.deepEqual(parseIpRateLimitBanKey('{"category":"content","ip":"203.0.113.8"}'), {
    category: "content",
    ip: "203.0.113.8",
  });
  assert.deepEqual(parseIpRateLimitBanKey('{"category":"search","ip":"2001:db8::8"}'), {
    category: "search",
    ip: "2001:db8::8",
  });
  assert.equal(parseIpRateLimitBanKey('{"category":"admin","ip":"203.0.113.8"}'), null);
  assert.equal(parseIpRateLimitBanKey('{"category":"content","ip":"not-an-ip"}'), null);
  assert.equal(parseIpRateLimitBanKey("invalid-json"), null);
});

test("persists and removes an IP ban with the same category and address key", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-rate-limit-"));
  const previousDatabasePath = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "novels.db");
  const { getDb } = await import("./db");
  const rule: IpRateLimitRule = { ...baseRule, id: "content-test", maxRequests: 1, banMode: "permanent" };
  try {
    assert.equal(checkIpRateLimit({ category: "content", ip: "203.0.113.9", rules: [rule], now: 1_000 }).allowed, true);
    assert.equal(checkIpRateLimit({ category: "content", ip: "203.0.113.9", rules: [rule], now: 1_001 }).permanent, true);
    getDb()
      .prepare("INSERT INTO analytics_events (event_type, path, ip, country) VALUES ('content_view', '/novel/1', ?, 'CN')")
      .run("203.0.113.9");
    const bans = listIpRateLimitBans("content", 10, 1_002);
    assert.equal(bans.length, 1);
    assert.equal(bans[0].country, "CN");
    assert.equal(deleteIpRateLimitBan("content", "203.0.113.9"), true);
    assert.equal(listIpRateLimitBans("content", 10, 1_003).length, 0);
  } finally {
    getDb().close();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
