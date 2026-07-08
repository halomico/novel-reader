import assert from "node:assert/strict";
import test from "node:test";
import { formatLocalDateTime, parseAppDateTime, toDateTimeAttribute } from "./date-time";

test("parses SQLite timestamps as UTC", () => {
  assert.equal(parseAppDateTime("2026-07-08 10:00:00")?.toISOString(), "2026-07-08T10:00:00.000Z");
});

test("parses SQLite timestamps with fractional seconds as UTC", () => {
  assert.equal(parseAppDateTime("2026-07-08 10:00:00.25")?.toISOString(), "2026-07-08T10:00:00.250Z");
});

test("keeps ISO timestamps as absolute instants", () => {
  assert.equal(toDateTimeAttribute("2026-07-08T10:00:00.000Z"), "2026-07-08T10:00:00.000Z");
});

test("formats SQLite UTC timestamps into a requested local timezone", () => {
  assert.equal(formatLocalDateTime("2026-07-08 10:00:00", { timeZone: "UTC" }), "2026/7/8 10:00:00");
  assert.equal(formatLocalDateTime("2026-07-08 10:00:00", { timeZone: "Asia/Shanghai" }), "2026/7/8 18:00:00");
});
