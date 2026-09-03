import assert from "node:assert/strict";
import test from "node:test";
import { getClientIp, matchesIpRule, normalizeAdminNetworkRules } from "./admin-access";

const previousMode = process.env.TRUST_PROXY_MODE;
const previousSecret = process.env.TRUST_PROXY_SECRET;
process.env.TRUST_PROXY_MODE = "signed";
process.env.TRUST_PROXY_SECRET = "0123456789abcdef0123456789abcdef";
test.after(() => {
  if (previousMode === undefined) delete process.env.TRUST_PROXY_MODE; else process.env.TRUST_PROXY_MODE = previousMode;
  if (previousSecret === undefined) delete process.env.TRUST_PROXY_SECRET; else process.env.TRUST_PROXY_SECRET = previousSecret;
});

test("IP and CIDR rules handle IPv4, IPv6, mapped IPv4 and wildcards", () => {
  assert.equal(matchesIpRule("203.0.113.7", "203.0.113.7"), true);
  assert.equal(matchesIpRule("203.0.113.7", "203.0.113.0/24"), true);
  assert.equal(matchesIpRule("2001:db8::7", "2001:db8::/32"), true);
  assert.equal(matchesIpRule("::ffff:203.0.113.7", "203.0.113.7"), true);
  assert.equal(matchesIpRule("203.0.113.7", "198.51.100.0/24"), false);
});

test("network rule normalization rejects malformed values", () => {
  assert.deepEqual(normalizeAdminNetworkRules(["203.0.113.7", "2001:db8::/32", "bad", "203.0.113.7"]), ["203.0.113.7", "2001:db8::/32"]);
});

test("admin client IP is accepted only from the signed proxy header", () => {
  assert.equal(getClientIp(new Headers({
    "x-novel-proxy-secret": process.env.TRUST_PROXY_SECRET!,
    "x-novel-client-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.1",
  })), "203.0.113.8");
  assert.equal(getClientIp(new Headers({
    "x-novel-proxy-secret": "wrong",
    "x-novel-client-ip": "203.0.113.8",
  })), "unknown");
});
