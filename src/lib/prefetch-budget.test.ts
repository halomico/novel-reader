import assert from "node:assert/strict";
import test from "node:test";
import {
  createPrefetchBudget,
  isServerBusyStatus,
  PREFETCH_BUSY_PAUSE_MS,
  PREFETCH_TTL_MS,
  PREFETCH_WINDOW_LIMIT,
  PREFETCH_WINDOW_MS,
} from "./prefetch-budget";

function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (milliseconds: number) => { time += milliseconds; } };
}

test("a URL is prefetched once until the router's copy would be stale", () => {
  const { now, advance } = clock();
  const budget = createPrefetchBudget(now);
  assert.equal(budget.tryAcquire("/books/1", "hover"), true);
  assert.equal(budget.tryAcquire("/books/1", "press"), false, "a press does not refetch a fresh prefetch");
  advance(PREFETCH_TTL_MS);
  assert.equal(budget.tryAcquire("/books/1", "hover"), true);
});

test("sweeping the pointer down a list starts only a few speculative renders", () => {
  const { now, advance } = clock();
  const budget = createPrefetchBudget(now);
  const started = Array.from({ length: 40 }, (_, row) => budget.tryAcquire(`/books/${row}`, "hover"))
    .filter(Boolean).length;
  assert.equal(started, PREFETCH_WINDOW_LIMIT);
  assert.equal(budget.tryAcquire("/books/99", "idle"), false, "idle prefetches share the window");
  advance(PREFETCH_WINDOW_MS);
  assert.equal(budget.tryAcquire("/books/99", "hover"), true);
});

test("a press is outside the window because its click fetches the page anyway", () => {
  const { now } = clock();
  const budget = createPrefetchBudget(now);
  for (let row = 0; row < PREFETCH_WINDOW_LIMIT; row += 1) budget.tryAcquire(`/books/${row}`, "hover");
  assert.equal(budget.tryAcquire("/books/50", "hover"), false);
  assert.equal(budget.tryAcquire("/books/50", "press"), true);
});

test("a busy answer from the server pauses every kind of prefetch", () => {
  const { now, advance } = clock();
  const budget = createPrefetchBudget(now);
  budget.pause();
  assert.equal(budget.tryAcquire("/novels?page=2", "press"), false);
  advance(PREFETCH_BUSY_PAUSE_MS);
  assert.equal(budget.tryAcquire("/novels?page=2", "press"), true);
  assert.equal(isServerBusyStatus(429), true);
  assert.equal(isServerBusyStatus(503), true);
  assert.equal(isServerBusyStatus(200), false);
  assert.equal(isServerBusyStatus(undefined), false);
});
