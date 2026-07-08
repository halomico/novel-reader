import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAnalyticsRange, parseUserAgent } from "./analytics";

test("normalizes analytics ranges", () => {
  assert.equal(normalizeAnalyticsRange("24h"), "24h");
  assert.equal(normalizeAnalyticsRange("7d"), "7d");
  assert.equal(normalizeAnalyticsRange("30d"), "30d");
  assert.equal(normalizeAnalyticsRange("custom"), "custom");
  assert.equal(normalizeAnalyticsRange("90d"), "24h");
});

test("parses common desktop browser user agents", () => {
  const result = parseUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  );
  assert.deepEqual(result, {
    device: "desktop",
    browser: "chrome",
    os: "windows",
  });
});

test("parses mobile user agents", () => {
  const result = parseUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  );
  assert.deepEqual(result, {
    device: "mobile",
    browser: "safari",
    os: "ios",
  });
});
