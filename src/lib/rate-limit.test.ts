import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit, clearRateLimitBucketsByPrefix } from "./rate-limit";

test("uses an explicit zero timestamp and resets at the window boundary", () => {
  const key = "rate-limit-zero-time";
  assert.deepEqual(checkRateLimit({ key, limit: 1, windowMs: 1_000, now: 0 }), {
    allowed: true,
    retryAfterSeconds: 0,
  });
  assert.deepEqual(checkRateLimit({ key, limit: 1, windowMs: 1_000, now: 500 }), {
    allowed: false,
    retryAfterSeconds: 1,
  });
  assert.deepEqual(checkRateLimit({ key, limit: 1, windowMs: 1_000, now: 1_000 }), {
    allowed: true,
    retryAfterSeconds: 0,
  });
});

test("clears only rate limit buckets matching the requested prefix", () => {
  const targetKey = "content:ip:203.0.113.8:rule:minute";
  const otherKey = "search:ip:203.0.113.8:rule:minute";

  checkRateLimit({ key: targetKey, limit: 1, windowMs: 60_000, now: 0 });
  checkRateLimit({ key: otherKey, limit: 1, windowMs: 60_000, now: 0 });
  assert.equal(clearRateLimitBucketsByPrefix("content:ip:203.0.113.8:rule:"), 1);
  assert.equal(checkRateLimit({ key: targetKey, limit: 1, windowMs: 60_000, now: 1 }).allowed, true);
  assert.equal(checkRateLimit({ key: otherKey, limit: 1, windowMs: 60_000, now: 1 }).allowed, false);
});
