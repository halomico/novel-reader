import assert from "node:assert/strict";
import test from "node:test";
import { ipRateLimitRuleApplies } from "./ip-rate-limit";
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
