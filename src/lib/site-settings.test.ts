import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

test("atomically replaces an existing settings file", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-settings-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");

  try {
    const defaults = readSiteSettings();
    assert.equal(defaults.videoLibraryEnabled, true);
    assert.equal(defaults.audioLibraryEnabled, true);
    assert.equal(defaults.fileLibraryEnabled, true);
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
