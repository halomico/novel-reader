import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseContextHistoryBack,
  createContextNavigationRecord,
  normalizeContextHref,
} from "./context-navigation";

const origin = "https://reader.example";

test("normalizes same-origin navigation URLs without hashes", () => {
  assert.equal(
    normalizeContextHref("https://reader.example/novels?page=2#book-8", origin),
    "/novels?page=2",
  );
  assert.equal(normalizeContextHref("https://outside.example/novels", origin), null);
});

test("allows a client-side context return in the same runtime", () => {
  const record = createContextNavigationRecord({
    sourceHref: "/search?q=风&page=3",
    destinationHref: "/books/8?from=%2Fsearch%3Fq%3D%E9%A3%8E%26page%3D3#seg-12",
    origin,
    runtimeId: "runtime-a",
    now: 1_000,
  });
  assert.equal(canUseContextHistoryBack({
    record,
    currentHref: "/books/8?from=%2Fsearch%3Fq%3D%E9%A3%8E%26page%3D3#seg-12",
    expectedReturnHref: "/search?q=风&page=3",
    origin,
    runtimeId: "runtime-a",
    historyLength: 4,
    now: 2_000,
  }), true);
});

test("rejects a record created by an earlier document runtime", () => {
  const record = createContextNavigationRecord({
    sourceHref: "/novels?page=2",
    destinationHref: "/books/8?from=%2Fnovels%3Fpage%3D2",
    origin,
    runtimeId: "source-runtime",
    now: 1_000,
  });
  const input = {
    record,
    currentHref: "/books/8?from=%2Fnovels%3Fpage%3D2",
    expectedReturnHref: "/novels?page=2",
    origin,
    runtimeId: "reader-runtime",
    historyLength: 3,
    now: 2_000,
  };
  assert.equal(canUseContextHistoryBack(input), false);
});

test("accepts the canonical chapter redirect for a clicked book", () => {
  const record = createContextNavigationRecord({
    sourceHref: "/novels",
    destinationHref: "/books/8?from=%2Fnovels",
    origin,
    runtimeId: "source-runtime",
    now: 1_000,
  });
  assert.equal(canUseContextHistoryBack({
    record,
    currentHref: "/books/8/chapters/21?from=%2Fnovels",
    expectedReturnHref: "/novels",
    origin,
    runtimeId: "source-runtime",
    historyLength: 2,
    now: 2_000,
  }), true);
});

test("rejects direct entries, stale records, and unrelated destinations", () => {
  const record = createContextNavigationRecord({
    sourceHref: "/novels",
    destinationHref: "/books/8?from=%2Fnovels",
    origin,
    runtimeId: "runtime-a",
    now: 1_000,
  });
  const base = {
    record,
    currentHref: "/books/8?from=%2Fnovels",
    expectedReturnHref: "/novels",
    origin,
    runtimeId: "runtime-b",
    historyLength: 2,
  };
  assert.equal(canUseContextHistoryBack({ ...base, now: 2_000 }), false);
  assert.equal(canUseContextHistoryBack({ ...base, currentHref: "/books/9", now: 2_000 }), false);
  assert.equal(canUseContextHistoryBack({ ...base, historyLength: 1, now: 2_000 }), false);
  assert.equal(canUseContextHistoryBack({ ...base, now: 8 * 24 * 60 * 60 * 1000 }), false);
  assert.equal(canUseContextHistoryBack({ ...base, runtimeId: "runtime-a", expectedReturnHref: "/tags", now: 2_000 }), false);
});
