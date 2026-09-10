import assert from "node:assert/strict";
import test from "node:test";
import { contentSecurityPolicy } from "./content-security-policy";

function directives(env: Parameters<typeof contentSecurityPolicy>[0]) {
  return new Map(contentSecurityPolicy(env).split("; ").map((directive) => {
    const [key, ...values] = directive.split(" ");
    return [key, values];
  }));
}

test("production CSP supports HLS workers and permits only configured public media origins", () => {
  const policy = directives({ NODE_ENV: "production", MEDIA_STORAGE_MODE: "remote", MEDIA_PUBLIC_URL: "https://media.example.com", MEDIA_CONTROL_URL: "http://internal:3100" });
  for (const key of ["media-src", "img-src", "connect-src"]) {
    assert.ok(policy.get(key)?.includes("https://media.example.com"));
    assert.ok(!policy.get(key)?.includes("http://internal:3100"));
  }
  assert.ok(!policy.get("script-src")?.includes("https://media.example.com"));
  assert.deepEqual(policy.get("worker-src"), ["'self'", "blob:"]);
  assert.ok(!policy.get("script-src")?.includes("'unsafe-eval'"));
});

test("CSP reads multi-node and analytics origins from each runtime environment", () => {
  const policy = directives({
    MEDIA_STORAGE_MODE: "remote",
    MEDIA_NODES_JSON: JSON.stringify([{ publicUrl: "https://video.example.com", controlUrl: "http://internal" }, { publicUrl: "https://audio.example.com" }]),
    MEDIA_PUBLIC_URL: "https://retired.example.com",
    SCRIPT_URL: "https://stats.example.com/script.js",
  });
  assert.ok(policy.get("connect-src")?.includes("https://video.example.com"));
  assert.ok(policy.get("img-src")?.includes("https://audio.example.com"));
  assert.ok(!policy.get("connect-src")?.includes("https://retired.example.com"));
  assert.ok(policy.get("script-src")?.includes("https://stats.example.com"));
  assert.ok(!contentSecurityPolicy({}).includes("video.example.com"));
});

test("CSP rejects credentials and non-HTTP origins and keeps HMR allowances development-only", () => {
  const invalid = contentSecurityPolicy({ SCRIPT_URL: "https://user:password@bad.example.com/x.js", UMAMI_RECORDER_URL: "javascript:alert(1)", MEDIA_STORAGE_MODE: "remote", MEDIA_NODES_JSON: "not-json" });
  assert.ok(!invalid.includes("bad.example.com"));
  assert.ok(!invalid.includes("javascript:"));
  assert.ok(!invalid.includes("null"));
  const dev = directives({ NODE_ENV: "development" });
  assert.ok(dev.get("script-src")?.includes("'unsafe-eval'"));
  assert.ok(dev.get("connect-src")?.includes("ws:"));
});
