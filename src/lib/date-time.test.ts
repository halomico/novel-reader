import assert from "node:assert/strict";
import test from "node:test";
import { formatCompactUpdateDate, formatLocalDateTime, formatRelativeUpdateTime, parseAppDateTime, toDateTimeAttribute } from "./date-time";

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

test("uses a compact month-day date within one year and adds the year only when older", () => {
  const now = Date.UTC(2026, 7, 4, 12);

  assert.equal(formatCompactUpdateDate(Date.UTC(2026, 7, 4, 10), { now, timeZone: "UTC" }), "08-04");
  assert.equal(formatCompactUpdateDate(now - 365 * 24 * 60 * 60 * 1_000, { now, timeZone: "UTC" }), "08-04");
  assert.equal(formatCompactUpdateDate(Date.UTC(2025, 7, 3, 12), { now, timeZone: "UTC" }), "2025-08-03");
});

test("formats recent updates with the shared relative-time scale", () => {
  const now = Date.UTC(2026, 8, 2, 12);
  const labels = { justNow: "刚刚", minutesAgo: "分钟前", hoursAgo: "小时前", daysAgo: "天前" };
  assert.equal(formatRelativeUpdateTime(now - 30_000, labels, now), "刚刚");
  assert.equal(formatRelativeUpdateTime(now - 5 * 60_000, labels, now), "5分钟前");
  assert.equal(formatRelativeUpdateTime(now - 3 * 60 * 60_000, labels, now), "3小时前");
  assert.equal(formatRelativeUpdateTime(now - 2 * 24 * 60 * 60_000, labels, now), "2天前");
  assert.equal(formatRelativeUpdateTime(now - 8 * 24 * 60 * 60_000, labels, now), "08-25");
});
