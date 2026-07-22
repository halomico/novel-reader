import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  isMediaKindAccessible,
  normalizeMediaFile,
  normalizeMediaSortBy,
  normalizeMediaSortOrder,
  parseMediaByteRange,
  sortMediaFolders,
  type MediaFolder,
} from "./media";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

test("applies public, signed-in, and disabled media access modes", (t) => {
  const originalSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-media-access-"));
  process.env.ADMIN_SETTINGS_PATH = path.join(directory, "settings.json");
  t.after(() => {
    if (originalSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = originalSettingsPath;
    fs.rmSync(directory, { recursive: true, force: true });
  });

  writeSiteSettings({
    ...readSiteSettings(),
    videoLibraryEnabled: true,
    audioLibraryEnabled: true,
    fileLibraryEnabled: false,
    guestVideoNavEnabled: true,
    guestAudioNavEnabled: false,
    guestFileNavEnabled: true,
  });

  assert.equal(isMediaKindAccessible("video", false), true);
  assert.equal(isMediaKindAccessible("audio", false), false);
  assert.equal(isMediaKindAccessible("audio", true), true);
  assert.equal(isMediaKindAccessible("file", true), false);
  assert.equal(isMediaKindAccessible("file", false), false);
});

test("normalizes supported native media files", () => {
  assert.deepEqual(normalizeMediaFile({ kind: "video", fileName: "demo.MP4", mimeType: "" }), {
    fileName: "demo.MP4",
    extension: ".mp4",
    mimeType: "video/mp4",
  });
  assert.equal(normalizeMediaFile({ kind: "audio", fileName: "demo.exe", mimeType: "application/octet-stream" }), null);
  assert.equal(normalizeMediaFile({ kind: "file", fileName: "", mimeType: "" }), null);
});

test("parses standard and suffix media ranges", () => {
  assert.deepEqual(parseMediaByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(parseMediaByteRange("bytes=90-", 100), { start: 90, end: 99 });
  assert.deepEqual(parseMediaByteRange("bytes=-10", 100), { start: 90, end: 99 });
  assert.equal(parseMediaByteRange("bytes=100-", 100), "invalid");
  assert.equal(parseMediaByteRange("bytes=20-10", 100), "invalid");
  assert.equal(parseMediaByteRange(null, 100), null);
});

test("normalizes media sorting and orders folders by name, item count, size, or update time", () => {
  assert.equal(normalizeMediaSortBy("manual"), "name");
  assert.equal(normalizeMediaSortBy("name"), "name");
  assert.equal(normalizeMediaSortBy("duration"), "duration");
  assert.equal(normalizeMediaSortBy("plays"), "plays");
  assert.equal(normalizeMediaSortBy("invalid"), "name");
  assert.equal(normalizeMediaSortOrder(undefined, "name"), "asc");
  assert.equal(normalizeMediaSortOrder(undefined, "updated"), "desc");

  const folders: MediaFolder[] = [
    { path: "B", name: "B", depth: 0, directAssets: 1, totalAssets: 4, totalSizeBytes: 20, mtimeMs: 10 },
    { path: "A", name: "A", depth: 0, directAssets: 2, totalAssets: 8, totalSizeBytes: 10, mtimeMs: 20 },
  ];
  assert.deepEqual(sortMediaFolders(folders, "name", "asc").map((folder) => folder.name), ["A", "B"]);
  assert.deepEqual(sortMediaFolders(folders, "duration", "desc").map((folder) => folder.name), ["A", "B"]);
  assert.deepEqual(sortMediaFolders(folders, "size", "desc").map((folder) => folder.name), ["B", "A"]);
  assert.deepEqual(sortMediaFolders(folders, "updated", "desc").map((folder) => folder.name), ["A", "B"]);
});
