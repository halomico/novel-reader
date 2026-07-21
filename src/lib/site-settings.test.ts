import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canAccessAdvancedTagSearch, canAccessNovelLibrary, isAdvancedTagSearchPublic, isNovelLibraryPublic } from "./config";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

test("atomically replaces an existing settings file", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-settings-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    const defaults = readSiteSettings();
    assert.equal(defaults.novelLibraryEnabled, true);
    assert.equal(defaults.videoLibraryEnabled, true);
    assert.equal(defaults.audioLibraryEnabled, true);
    assert.equal(defaults.fileLibraryEnabled, true);
    assert.equal(defaults.tagLibraryEnabled, true);
    assert.equal(defaults.advancedTagSearchEnabled, false);
    assert.equal(defaults.hotwordLinksEnabled, true);
    assert.equal(defaults.guestTagLibraryNavEnabled, false);
    assert.equal(defaults.guestAdvancedTagSearchEnabled, false);
    assert.equal(defaults.guestHotwordLinksEnabled, false);
    assert.equal(defaults.randomCatalogEnabled, true);
    assert.equal(defaults.defaultPalette, "default");
    assert.equal(defaults.defaultPaletteRandomEnabled, false);
    assert.equal(defaults.manualPinnedNovelsEnabled, true);
    assert.equal(defaults.randomRecommendationsEnabled, false);
    assert.equal(defaults.audioDefaultPlaybackMode, "next");
    assert.equal(defaults.userDailyReportLimit, 50);
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
      randomRecommendationCount: 500,
      randomRecommendationIntervalMinutes: 20_000,
    });
    const settings = readSiteSettings();
    assert.equal(settings.defaultPaletteRandomEnabled, true);
    assert.equal(settings.defaultPaletteRotationMinutes, 1);
    assert.equal(settings.manualPinnedNovelsEnabled, false);
    assert.equal(settings.randomRecommendationsEnabled, true);
    assert.equal(settings.randomRecommendationCount, 50);
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

test("applies disabled, signed-in, and public novel access modes", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-access-mode-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    const defaults = readSiteSettings();
    writeSiteSettings({ ...defaults, novelLibraryEnabled: false, guestLibraryNavEnabled: true });
    assert.equal(canAccessNovelLibrary(false), false);
    assert.equal(canAccessNovelLibrary(true), false);
    assert.equal(isNovelLibraryPublic(), false);

    writeSiteSettings({ ...readSiteSettings(), novelLibraryEnabled: true, guestLibraryNavEnabled: false });
    assert.equal(canAccessNovelLibrary(false), false);
    assert.equal(canAccessNovelLibrary(true), true);
    assert.equal(isNovelLibraryPublic(), false);

    writeSiteSettings({ ...readSiteSettings(), guestLibraryNavEnabled: true });
    assert.equal(canAccessNovelLibrary(false), true);
    assert.equal(isNovelLibraryPublic(), true);
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
      guestLibraryNavEnabled: true,
    });
    assert.equal(canAccessAdvancedTagSearch(false), false);
    assert.equal(canAccessAdvancedTagSearch(true), false);

    writeSiteSettings({ ...readSiteSettings(), advancedTagSearchEnabled: true });
    assert.equal(canAccessAdvancedTagSearch(false), false);
    assert.equal(canAccessAdvancedTagSearch(true), true);
    assert.equal(isAdvancedTagSearchPublic(), false);

    writeSiteSettings({ ...readSiteSettings(), guestAdvancedTagSearchEnabled: true });
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
        frontendSearchConcurrencyLimit: 8,
        adminIndexPageSize: 30,
        frontendAutoIndexEnabled: true,
        contentIndexMaxSegments: 5000,
        contentIndexSoftLimitBytes: 1024,
        contentIndexHardLimitBytes: 2048,
        manualIndexMaxSegmentsEnabled: true,
        manualIndexMaxSegments: 10000,
        noticeStayVisibleAfterBlur: true,
      }),
      "utf8",
    );
    const settings = readSiteSettings();
    assert.equal(settings.siteName, "保留站点");
    assert.equal(settings.frontendSearchConcurrencyLimit, 8);
    const stored = JSON.parse(fs.readFileSync(process.env.ADMIN_SETTINGS_PATH, "utf8")) as Record<string, unknown>;
    assert.equal(stored.siteName, "保留站点");
    assert.equal(stored.frontendSearchConcurrencyLimit, 8);
    for (const key of [
      "adminIndexPageSize",
      "frontendAutoIndexEnabled",
      "contentIndexMaxSegments",
      "contentIndexSoftLimitBytes",
      "contentIndexHardLimitBytes",
      "manualIndexMaxSegmentsEnabled",
      "manualIndexMaxSegments",
      "noticeStayVisibleAfterBlur",
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
