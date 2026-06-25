import assert from "node:assert/strict";
import test from "node:test";
import { getClientIp, matchesIpRule } from "./admin-access";

test("matches exact IP rules", () => {
  assert.equal(matchesIpRule("192.168.1.5", "192.168.1.5"), true);
  assert.equal(matchesIpRule("192.168.1.6", "192.168.1.5"), false);
});

test("matches wildcard prefix rules", () => {
  assert.equal(matchesIpRule("10.0.3.8", "10.0.*"), true);
  assert.equal(matchesIpRule("10.1.3.8", "10.0.*"), false);
});

test("matches IPv4 CIDR rules", () => {
  assert.equal(matchesIpRule("172.16.10.12", "172.16.0.0/16"), true);
  assert.equal(matchesIpRule("172.17.10.12", "172.16.0.0/16"), false);
});

test("matches IPv6 exact and CIDR rules", () => {
  assert.equal(matchesIpRule("::1", "::1"), true);
  assert.equal(matchesIpRule("2001:db8::42", "2001:db8::/32"), true);
  assert.equal(matchesIpRule("2001:db9::42", "2001:db8::/32"), false);
});

test("matches IPv4-mapped IPv6 against IPv4 rules", () => {
  assert.equal(matchesIpRule("::ffff:203.0.113.9", "203.0.113.9"), true);
  assert.equal(matchesIpRule("::ffff:203.0.113.9", "203.0.113.0/24"), true);
});

test("normalizes forwarded client IP display values", () => {
  assert.equal(getClientIp(new Headers({ "x-forwarded-for": "[2001:db8::12]:443, 10.0.0.1" })), "2001:db8::12");
  assert.equal(getClientIp(new Headers({ "x-real-ip": "203.0.113.9:443" })), "203.0.113.9");
});
