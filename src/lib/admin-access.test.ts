import assert from "node:assert/strict";
import test from "node:test";
import { matchesIpRule } from "./admin-access";

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
