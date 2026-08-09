import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  languageAlternates,
  localeFromPathname,
  prefersTraditionalLanguage,
  stripLocalePath,
  TRADITIONAL_LOCALE,
  withLocalePath,
} from "./locale";
import { localizeText, normalizeSearchText } from "./locale-server";

test("keeps simplified URLs canonical and prefixes traditional public pages", () => {
  assert.equal(withLocalePath("/novels?page=2#list", DEFAULT_LOCALE), "/novels?page=2#list");
  assert.equal(withLocalePath("/novels?page=2#list", TRADITIONAL_LOCALE), "/zh-hant/novels?page=2#list");
  assert.equal(withLocalePath("/admin/settings", TRADITIONAL_LOCALE), "/admin/settings");
  assert.equal(localeFromPathname("/zh-hant/books/3"), TRADITIONAL_LOCALE);
  assert.equal(stripLocalePath("/zh-hant/books/3"), "/books/3");
  assert.deepEqual(languageAlternates("/tags"), {
    "zh-Hans": "/tags",
    "zh-Hant": "/zh-hant/tags",
    "x-default": "/tags",
  });
});

test("uses explicit Chinese language preferences before the country hint", () => {
  assert.equal(prefersTraditionalLanguage("zh-Hant-TW,zh;q=0.9", null), true);
  assert.equal(prefersTraditionalLanguage("zh-CN,zh;q=0.9", "TW"), true);
  assert.equal(prefersTraditionalLanguage("en-US,en;q=0.9", "HK"), true);
  assert.equal(prefersTraditionalLanguage("zh-CN,zh;q=0.9", "SG"), false);
});

test("converts display text and normalizes traditional search input on demand", async () => {
  assert.equal(await localizeText("小说标签与阅读记录", TRADITIONAL_LOCALE), "小說標籤與閱讀記錄");
  assert.equal(await normalizeSearchText("小說標籤與閱讀記錄"), "小说标签与阅读记录");
});
