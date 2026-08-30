import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LOCALE,
  languageAlternates,
  localeFromPathname,
  prefersTraditionalLanguage,
  stripLocalePath,
  TRADITIONAL_LOCALE,
  uiText,
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
  assert.equal(prefersTraditionalLanguage("zh-CN,zh;q=0.9", "TW"), false);
  assert.equal(prefersTraditionalLanguage("zh-TW;q=0.8,zh-CN;q=0.9", "TW"), false);
  assert.equal(prefersTraditionalLanguage("zh-TW;q=0,zh-CN;q=0.9", "TW"), false);
  assert.equal(prefersTraditionalLanguage("en-US,en;q=0.9", "HK"), true);
  assert.equal(prefersTraditionalLanguage("zh-CN,zh;q=0.9", "SG"), false);
  assert.equal(prefersTraditionalLanguage("en-US,en;q=0.9", "US"), false);
});

test("converts display text and normalizes traditional search input on demand", async () => {
  assert.equal(await localizeText("小说标签与阅读记录", TRADITIONAL_LOCALE), "小說標籤與閱讀記錄");
  assert.equal(await normalizeSearchText("小說標籤與閱讀記錄"), "小说标签与阅读记录");
  assert.equal(uiText(TRADITIONAL_LOCALE, "默认"), "預設");
  assert.equal(uiText(TRADITIONAL_LOCALE, "发布于"), "發佈於");
  assert.equal(uiText(TRADITIONAL_LOCALE, "万字"), "萬字");
  assert.equal(uiText(TRADITIONAL_LOCALE, "来源"), "來源");
  assert.equal(uiText(TRADITIONAL_LOCALE, "搜索视频"), "搜尋視頻");
  assert.equal(uiText(TRADITIONAL_LOCALE, "搜索音频"), "搜尋音頻");
  assert.equal(uiText(TRADITIONAL_LOCALE, "搜索文件"), "搜尋文件");
});
