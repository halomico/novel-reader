import assert from "node:assert/strict";
import test from "node:test";
import { checkRateLimit } from "./rate-limit";

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
