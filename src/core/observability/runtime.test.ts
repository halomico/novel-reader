import assert from "node:assert/strict";
import test from "node:test";
import { elapsedMilliseconds, formatServerTiming, getRuntimeMetrics, initializeRuntimeMetrics } from "./runtime";

test("Server-Timing formatter keeps only finite durations and sanitizes metadata", () => {
  assert.equal(formatServerTiming([
    { name: "database read", durationMs: 1.26, description: "sqlite\"probe\u0000" },
    { name: "ignored", durationMs: Number.NaN },
  ]), 'database_read;dur=1.3;desc="sqlite_probe_"');
});

test("runtime metrics initialize once and expose bounded process measurements", () => {
  initializeRuntimeMetrics();
  initializeRuntimeMetrics();
  const metrics = getRuntimeMetrics();
  assert.match(metrics.processStartedAt, /^\d{4}-\d{2}-\d{2}T/u);
  assert.ok(metrics.uptimeSeconds >= 0);
  assert.ok(metrics.memory.rssBytes > 0);
  assert.ok(metrics.memory.heapUsedBytes > 0);
  assert.ok(metrics.eventLoop.resolutionMs >= 10);
  assert.ok(metrics.eventLoop.samples >= 0);
});

test("elapsed duration is non-negative", () => {
  assert.ok(elapsedMilliseconds(performance.now()) >= 0);
});
