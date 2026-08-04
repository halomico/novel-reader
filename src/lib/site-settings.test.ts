import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { HomePortalCardKey } from "./home-portal";
import {
  isHomePortalCardVisible,
  resolveHomePortalAccessMode,
} from "./home-portal";
import {
  canAccessAdvancedTagSearch,
  canAccessHomeAnnouncementCard,
  canAccessNovelLibrary,
  canConsumeNovelLibrary,
  getSettingsPreviewText,
  isAdvancedTagSearchPublic,
  isNovelLibraryPublic,
} from "./config";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

test("atomically replaces an existing settings file", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-settings-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    const defaults = readSiteSettings();
    assert.deepEqual(defaults.homePortalAccessModes, {
      announcement: "public",
      novels: "member",
      tags: "member",
      video: "member",
      audio: "member",
      file: "member",
    });
    assert.equal(defaults.advancedTagSearchEnabled, false);
    assert.equal(defaults.hotwordLinksEnabled, true);
    assert.equal(defaults.guestAdvancedTagSearchEnabled, false);
    assert.equal(defaults.guestHotwordLinksEnabled, false);
    assert.equal(defaults.randomCatalogEnabled, true);
    assert.equal(defaults.brandLinkTarget, "novels");
    assert.equal(defaults.defaultPalette, "default");
    assert.equal(defaults.defaultPaletteRandomEnabled, false);
    assert.equal(defaults.readerDefaultFontSize, 18);
    assert.equal(defaults.readerDefaultLineHeight, 1.7);
    assert.equal(defaults.readerDefaultTagsMode, "collapsed");
    assert.equal(defaults.manualPinnedNovelsEnabled, true);
    assert.equal(defaults.randomRecommendationsEnabled, false);
    assert.equal(defaults.catalogPromotionOrder, "manual-first");
    assert.equal(defaults.audioDefaultPlaybackMode, "next");
    assert.equal(defaults.userDailyReportLimit, 50);
    assert.equal(defaults.announcementCardTarget, "list");
    assert.equal(defaults.adminTheme, "system");
    assert.equal(defaults.adminIpAllowlistEnabled, false);
    assert.deepEqual(defaults.adminAllowedNetworks, []);
    assert.deepEqual(defaults.novelSourceSearchModes, {});
    writeSiteSettings({ ...defaults, siteName: "第一次" });
    writeSiteSettings({ ...readSiteSettings(), siteName: "第二次" });
    assert.equal(readSiteSettings().siteName, "第二次");
    assert.deepEqual(fs.readdirSync(tempDir), ["admin-settings.json"]);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes the configured user default palette", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-default-palette-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    writeSiteSettings({ ...readSiteSettings(), defaultPalette: "sakura" });
    assert.equal(readSiteSettings().defaultPalette, "sakura");
    fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ defaultPalette: "invalid" }), "utf8");
    assert.equal(readSiteSettings().defaultPalette, "default");
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes per-source search modes without persisting default entries", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-source-search-mode-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    fs.writeFileSync(
      process.env.ADMIN_SETTINGS_PATH,
      JSON.stringify({
        novelSourceSearchModes: {
          " Large-Library ": "book",
          default: "full",
          invalid: "other",
        },
      }),
      "utf8",
    );
    assert.deepEqual(readSiteSettings().novelSourceSearchModes, { "large-library": "book" });
  } finally {
    if (previousPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("preserves an empty settings preview and normalizes home portal settings", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-home-portal-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    writeSiteSettings({
      ...readSiteSettings(),
      settingsPreviewText: "",
      homePortalAccessModes: {
        ...readSiteSettings().homePortalAccessModes,
        announcement: "member",
        video: "browse",
      },
      announcementCardTarget: "latest",
      adminIpAllowlistEnabled: true,
      adminAllowedNetworks: ["203.0.113.8", "203.0.113.0/24", "203.0.113.8"],
      homePortalOrder: ["random", "novels", "random"] as HomePortalCardKey[],
    });
    const settings = readSiteSettings();
    assert.equal(getSettingsPreviewText(), "");
    assert.deepEqual(settings.homePortalOrder.slice(0, 3), ["recent", "novels", "announcement"]);
    assert.equal(canAccessHomeAnnouncementCard(false), false);
    assert.equal(canAccessHomeAnnouncementCard(true), true);
    assert.equal(settings.announcementCardTarget, "latest");
    assert.deepEqual(settings.adminAllowedNetworks, ["203.0.113.8", "203.0.113.0/24"]);
    assert.equal(settings.homePortalAccessModes.video, "browse");
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("separates public home-card display from public content access", () => {
  const publicMode = resolveHomePortalAccessMode(true, true, false);
  const browseMode = resolveHomePortalAccessMode(true, false, true);
  const memberMode = resolveHomePortalAccessMode(true, false, false);
  assert.equal(publicMode, "public");
  assert.equal(browseMode, "browse");
  assert.equal(memberMode, "member");
  assert.equal(isHomePortalCardVisible(browseMode, false), true);
  assert.equal(isHomePortalCardVisible(memberMode, false), false);
  assert.equal(isHomePortalCardVisible(memberMode, true), true);
  assert.equal(isHomePortalCardVisible(resolveHomePortalAccessMode(false, true, true), true), false);
});

test("clamps the configured reader font size to 8 through 25", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-font-size-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    writeSiteSettings({ ...readSiteSettings(), readerDefaultFontSize: 50 });
    assert.equal(readSiteSettings().readerDefaultFontSize, 25);
    writeSiteSettings({ ...readSiteSettings(), readerDefaultFontSize: 5 });
    assert.equal(readSiteSettings().readerDefaultFontSize, 8);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes the configured reader line height", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-line-height-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ readerDefaultLineHeight: 1.4 }), "utf8");
    assert.equal(readSiteSettings().readerDefaultLineHeight, 1.4);
    fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ readerDefaultLineHeight: 2.2, legacy: true }), "utf8");
    assert.equal(readSiteSettings().readerDefaultLineHeight, 2);
    fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ readerDefaultLineHeight: "invalid" }), "utf8");
    assert.equal(readSiteSettings().readerDefaultLineHeight, 1.7);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes palette rotation and random recommendation settings", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-random-settings-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    writeSiteSettings({
      ...readSiteSettings(),
      defaultPaletteRandomEnabled: true,
      defaultPaletteRotationMinutes: 0,
      manualPinnedNovelsEnabled: false,
      randomRecommendationsEnabled: true,
      catalogPromotionOrder: "random-first",
      randomRecommendationCount: 500,
      randomRecommendationIntervalMinutes: 20_000,
    });
    const settings = readSiteSettings();
    assert.equal(settings.defaultPaletteRandomEnabled, true);
    assert.equal(settings.defaultPaletteRotationMinutes, 1);
    assert.equal(settings.manualPinnedNovelsEnabled, false);
    assert.equal(settings.randomRecommendationsEnabled, true);
    assert.equal(settings.catalogPromotionOrder, "random-first");
    assert.equal(settings.randomRecommendationCount, 100);
    assert.equal(settings.randomRecommendationIntervalMinutes, 10_080);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalizes the reader tag default and catalog promotion order", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-display-defaults-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    fs.writeFileSync(
      process.env.ADMIN_SETTINGS_PATH,
      JSON.stringify({
        brandLinkTarget: "home",
        readerDefaultTagsMode: "expanded",
        catalogPromotionOrder: "random-first",
      }),
      "utf8",
    );
    assert.equal(readSiteSettings().brandLinkTarget, "home");
    assert.equal(readSiteSettings().readerDefaultTagsMode, "expanded");
    assert.equal(readSiteSettings().catalogPromotionOrder, "random-first");

    fs.writeFileSync(
      process.env.ADMIN_SETTINGS_PATH,
      JSON.stringify({
        brandLinkTarget: "invalid",
        readerDefaultTagsMode: "invalid",
        catalogPromotionOrder: "invalid",
      }),
      "utf8",
    );
    assert.equal(readSiteSettings().brandLinkTarget, "novels");
    assert.equal(readSiteSettings().readerDefaultTagsMode, "collapsed");
    assert.equal(readSiteSettings().catalogPromotionOrder, "manual-first");
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("applies disabled, signed-in, and public novel access modes", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-access-mode-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    const defaults = readSiteSettings();
    writeSiteSettings({ ...defaults, homePortalAccessModes: { ...defaults.homePortalAccessModes, novels: "off" } });
    assert.equal(canAccessNovelLibrary(false), false);
    assert.equal(canAccessNovelLibrary(true), false);
    assert.equal(isNovelLibraryPublic(), false);

    writeSiteSettings({
      ...readSiteSettings(),
      homePortalAccessModes: { ...readSiteSettings().homePortalAccessModes, novels: "member" },
    });
    assert.equal(canAccessNovelLibrary(false), false);
    assert.equal(canAccessNovelLibrary(true), true);
    assert.equal(isNovelLibraryPublic(), false);

    writeSiteSettings({
      ...readSiteSettings(),
      homePortalAccessModes: { ...readSiteSettings().homePortalAccessModes, novels: "browse" },
    });
    assert.equal(isHomePortalCardVisible("browse", false), true);
    assert.equal(canAccessNovelLibrary(false), false);
    assert.equal(canConsumeNovelLibrary(false), false);
    assert.equal(canConsumeNovelLibrary(true), true);
    assert.equal(isNovelLibraryPublic(), false);

    writeSiteSettings({
      ...readSiteSettings(),
      homePortalAccessModes: { ...readSiteSettings().homePortalAccessModes, novels: "public" },
    });
    assert.equal(canConsumeNovelLibrary(false), true);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("applies disabled, signed-in, and public advanced tag search modes", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-advanced-tag-access-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    const defaults = readSiteSettings();
    writeSiteSettings({
      ...defaults,
      advancedTagSearchEnabled: false,
      guestAdvancedTagSearchEnabled: false,
      homePortalAccessModes: {
        ...defaults.homePortalAccessModes,
        novels: "public",
        tags: "member",
      },
    });
    assert.equal(canAccessAdvancedTagSearch(false), false);
    assert.equal(canAccessAdvancedTagSearch(true), false);

    writeSiteSettings({ ...readSiteSettings(), advancedTagSearchEnabled: true });
    assert.equal(canAccessAdvancedTagSearch(false), false);
    assert.equal(canAccessAdvancedTagSearch(true), true);
    assert.equal(isAdvancedTagSearchPublic(), false);

    writeSiteSettings({
      ...readSiteSettings(),
      guestAdvancedTagSearchEnabled: true,
      homePortalAccessModes: { ...readSiteSettings().homePortalAccessModes, tags: "public" },
    });
    assert.equal(canAccessAdvancedTagSearch(false), true);
    assert.equal(isAdvancedTagSearchPublic(), true);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("removes retired settings while preserving current values", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-legacy-index-settings-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    fs.writeFileSync(
      process.env.ADMIN_SETTINGS_PATH,
      JSON.stringify({
        siteName: "保留站点",
        frontendSearchConcurrencyLimit: 100,
        adminIndexPageSize: 30,
        frontendAutoIndexEnabled: true,
        contentIndexMaxSegments: 5000,
        contentIndexSoftLimitBytes: 1024,
        contentIndexHardLimitBytes: 2048,
        manualIndexMaxSegmentsEnabled: true,
        manualIndexMaxSegments: 10000,
        noticeStayVisibleAfterBlur: true,
        adminOperationRateLimitEnabled: true,
        adminOperationRateLimitPerMinute: 60,
        adminOperationRateLimitBanEnabled: true,
        searchRateLimitPerMinute: 8,
        searchShortQueryRateLimitPerMinute: 3,
        searchRateLimitRules: [{ id: "legacy-search-rule" }],
        userSearchRateLimitPerMinute: 30,
      }),
      "utf8",
    );
    const settings = readSiteSettings();
    assert.equal(settings.siteName, "保留站点");
    assert.equal(settings.frontendSearchConcurrencyLimit, 100);
    const stored = JSON.parse(fs.readFileSync(process.env.ADMIN_SETTINGS_PATH, "utf8")) as Record<string, unknown>;
    assert.equal(stored.siteName, "保留站点");
    assert.equal(stored.frontendSearchConcurrencyLimit, 100);
    for (const key of [
      "adminIndexPageSize",
      "frontendAutoIndexEnabled",
      "contentIndexMaxSegments",
      "contentIndexSoftLimitBytes",
      "contentIndexHardLimitBytes",
      "manualIndexMaxSegmentsEnabled",
      "manualIndexMaxSegments",
      "noticeStayVisibleAfterBlur",
      "adminOperationRateLimitEnabled",
      "adminOperationRateLimitPerMinute",
      "adminOperationRateLimitBanEnabled",
      "searchRateLimitPerMinute",
      "searchShortQueryRateLimitPerMinute",
      "searchRateLimitRules",
      "userSearchRateLimitPerMinute",
    ]) {
      assert.equal(Object.hasOwn(stored, key), false);
    }
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
