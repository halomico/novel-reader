import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_CONTENT_INDEX_LIMIT_BYTES,
  readSiteSettings,
  writeSiteSettings,
} from "./site-settings";

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

test("allows content index limits up to 1000 GB", () => {
  const previousPath = process.env.ADMIN_SETTINGS_PATH;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-index-limits-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "admin-settings.json");
  const fiveHundredGb = 500 * 1024 ** 3;

  try {
    writeSiteSettings({
      ...readSiteSettings(),
      contentIndexSoftLimitBytes: fiveHundredGb,
      contentIndexHardLimitBytes: fiveHundredGb,
    });
    assert.equal(readSiteSettings().contentIndexSoftLimitBytes, fiveHundredGb);
    assert.equal(readSiteSettings().contentIndexHardLimitBytes, fiveHundredGb);

    writeSiteSettings({
      ...readSiteSettings(),
      contentIndexSoftLimitBytes: MAX_CONTENT_INDEX_LIMIT_BYTES + 1,
      contentIndexHardLimitBytes: MAX_CONTENT_INDEX_LIMIT_BYTES + 1,
    });
    assert.equal(readSiteSettings().contentIndexSoftLimitBytes, MAX_CONTENT_INDEX_LIMIT_BYTES);
    assert.equal(readSiteSettings().contentIndexHardLimitBytes, MAX_CONTENT_INDEX_LIMIT_BYTES);
  } finally {
    if (previousPath === undefined) {
      delete process.env.ADMIN_SETTINGS_PATH;
    } else {
      process.env.ADMIN_SETTINGS_PATH = previousPath;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
