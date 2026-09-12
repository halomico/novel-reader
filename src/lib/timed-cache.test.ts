import assert from "node:assert/strict";
import test from "node:test";
import { createTimedCache } from "./timed-cache";

test("entries are reused until their lifetime ends", () => {
  let time = 0;
  const cache = createTimedCache<string>({ ttlMs: 60_000, maxEntries: 4, now: () => time });
  cache.set("纸灯::1", "results");
  time = 59_999;
  assert.equal(cache.get("纸灯::1"), "results");
  time = 60_000;
  assert.equal(cache.get("纸灯::1"), undefined);
});

test("the oldest entries are dropped once the cache is full, and a rewrite refreshes an entry", () => {
  let time = 0;
  const cache = createTimedCache<number>({ ttlMs: 60_000, maxEntries: 2, now: () => time });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 3);
  cache.set("c", 4);
  assert.equal(cache.get("b"), undefined, "b was the oldest entry");
  assert.equal(cache.get("a"), 3);
  assert.equal(cache.get("c"), 4);
  time = 30_000;
  cache.set("a", 5);
  time = 70_000;
  assert.equal(cache.get("a"), 5, "rewriting restarts the lifetime");
  assert.equal(cache.get("c"), undefined);
});
