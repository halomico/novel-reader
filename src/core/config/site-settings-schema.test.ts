import assert from "node:assert/strict";
import test from "node:test";
import { defaultSiteSettings, normalizeIpRateLimitRules, normalizeSiteSettings } from "./site-settings-schema";

test("maximum-length duplicate rate-limit IDs resolve to distinct bounded IDs", () => {
  const base = "a".repeat(48);
  const rules = normalizeIpRateLimitRules(Array.from({ length: 20 }, () => ({ id: base })));
  assert.equal(rules.length, 20);
  assert.equal(new Set(rules.map((rule) => rule.id)).size, 20);
  assert.ok(rules.every((rule) => rule.id.length <= 48));
  assert.equal(rules[1].id, `${"a".repeat(46)}-2`);
  assert.equal(rules[19].id, `${"a".repeat(45)}-20`);
});

test("rate-limit ID collisions preserve a suffix even after truncation and sanitization", () => {
  const rules = normalizeIpRateLimitRules([
    { id: "same" }, { id: "same-2" }, { id: "same" }, { id: "same!" },
  ]);
  assert.deepEqual(rules.map((rule) => rule.id), ["same", "same-2", "same-3", "same-4"]);
});

test("pure site settings create isolated defaults and reject a malformed root", () => {
  const first = defaultSiteSettings();
  first.homePortalOrder.reverse();
  first.homePortalAccessModes.novels = "off";
  const second = defaultSiteSettings();
  assert.notDeepEqual(first.homePortalOrder, second.homePortalOrder);
  assert.equal(second.homePortalAccessModes.novels, "member");
  assert.equal(second.adminPasswordHash, "");
  for (const value of [null, [], "invalid", 1]) assert.throws(() => normalizeSiteSettings(value));
});

test("retired publish notices are removed and raised operational limits are preserved", () => {
  const settings = normalizeSiteSettings({
    originalPublishNoticeText: "旧提示",
    originalPublishNoticeLinkLabel: "旧链接",
    originalPublishNoticeUrl: "/old",
    globalSearchMaxResults: 10_000,
    analyticsRealtimeLimit: 100_000,
  });
  assert.equal(Object.hasOwn(settings, "originalPublishNoticeText"), false);
  assert.equal(Object.hasOwn(settings, "originalPublishNoticeLinkLabel"), false);
  assert.equal(Object.hasOwn(settings, "originalPublishNoticeUrl"), false);
  assert.equal(settings.globalSearchMaxResults, 10_000);
  assert.equal(settings.analyticsRealtimeLimit, 100_000);
});

test("defaults reader page turn mode to scroll and normalizes custom values", () => {
  assert.equal(defaultSiteSettings().readerDefaultPageTurn, "scroll");
  assert.equal(normalizeSiteSettings({}).readerDefaultPageTurn, "scroll");
  assert.equal(normalizeSiteSettings({ readerDefaultPageTurn: "slide" }).readerDefaultPageTurn, "slide");
  assert.equal(normalizeSiteSettings({ readerDefaultPageTurn: "instant" }).readerDefaultPageTurn, "instant");
  assert.equal(normalizeSiteSettings({ readerDefaultPageTurn: "invalid" }).readerDefaultPageTurn, "scroll");
});
