import assert from "node:assert/strict";
import test from "node:test";
import { getTrustedClientAddress } from "./client-ip";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

test("none mode ignores all forwarding headers", () => {
  const result = getTrustedClientAddress(headers({
    "cf-connecting-ip": "203.0.113.8",
    "x-forwarded-for": "198.51.100.3",
    "cf-ipcountry": "CN",
  }), { TRUST_PROXY_MODE: "none" } as NodeJS.ProcessEnv);
  assert.deepEqual(result, { ip: "unknown", country: "unknown", trusted: false, mode: "none" });
});

test("signed mode requires a valid shared secret and a single valid IP", () => {
  const env = {
    TRUST_PROXY_MODE: "signed",
    TRUST_PROXY_SECRET: "0123456789abcdef0123456789abcdef",
  } as NodeJS.ProcessEnv;
  assert.equal(getTrustedClientAddress(headers({
    "x-novel-proxy-secret": "wrong",
    "x-novel-client-ip": "203.0.113.8",
  }), env).ip, "unknown");
  assert.deepEqual(getTrustedClientAddress(headers({
    "x-novel-proxy-secret": env.TRUST_PROXY_SECRET!,
    "x-novel-client-ip": "203.0.113.8",
    "x-novel-country": "us",
  }), env), { ip: "203.0.113.8", country: "US", trusted: true, mode: "signed" });
  assert.equal(getTrustedClientAddress(headers({
    "x-novel-proxy-secret": env.TRUST_PROXY_SECRET!,
    "x-novel-client-ip": "203.0.113.8, 198.51.100.1",
  }), env).ip, "unknown");
});

test("Cloudflare headers are read only in explicit cloudflare mode", () => {
  const input = headers({ "cf-connecting-ip": "2001:db8::1", "cf-ipcountry": "JP" });
  assert.equal(getTrustedClientAddress(input, { TRUST_PROXY_MODE: "none" } as NodeJS.ProcessEnv).trusted, false);
  assert.deepEqual(getTrustedClientAddress(input, { TRUST_PROXY_MODE: "cloudflare" } as NodeJS.ProcessEnv), {
    ip: "2001:db8::1",
    country: "JP",
    trusted: true,
    mode: "cloudflare",
  });
});
