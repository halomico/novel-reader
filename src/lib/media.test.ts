import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  createVideoTag,
  isMediaKindAccessible,
  listMediaAssets,
  listMediaAssetsNeedingPreparation,
  listMediaFolders,
  listVideoTags,
  listVideoTagsForAsset,
  mediaThumbnailVersion,
  normalizeMediaFile,
  normalizeMediaSortBy,
  normalizeMediaSortOrder,
  parseMediaByteRange,
  saveMediaDuration,
  saveMediaThumbnailVersion,
  setVideoTagsForAssets,
  sortMediaFolders,
  updateVideoTag,
  type MediaFolder,
} from "./media";
import { getDb } from "./db";
import { naturalSortKey } from "./natural-sort";
import {
  claimMediaPreparationJob,
  completeMediaPreparationJob,
  failMediaPreparationJob,
  getMediaPreparationJob,
  reconcileMediaPreparationJobs,
} from "./media-preparation-jobs";
import { readSiteSettings, writeSiteSettings } from "./site-settings";

function withTempDatabase(t: TestContext) {
  const previousPath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-media-search-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & {
    novelReaderDb?: DatabaseSync;
    mediaLibrarySyncState?: unknown;
  };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  delete state.mediaLibrarySyncState;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    delete state.mediaLibrarySyncState;
    if (previousPath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousPath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

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
    homePortalAccessModes: {
      ...readSiteSettings().homePortalAccessModes,
      video: "public",
      audio: "member",
      file: "off",
    },
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
  assert.equal(normalizeMediaSortBy("published"), "published");
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

test("builds natural name keys for numbered media across pagination", () => {
  const names = ["第10集", "第2集", "第100集", "第1集", "第02集"];
  assert.deepEqual(
    names.sort((left, right) => naturalSortKey(left).localeCompare(naturalSortKey(right))),
    ["第1集", "第2集", "第02集", "第10集", "第100集"],
  );
});

test("searches media recursively with multiple terms and exposes matching folders", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO media_assets
      (kind, title, artist, description, file_name, stored_name, mime_type, size_bytes, mtime_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insert.run("audio", "星辰序曲", "林海", "", "track-01.mp3", "audio/归档/古典/track-01.mp3", "audio/mpeg", 100, 1);
  insert.run("audio", "山风", "林海", "", "track-02.mp3", "audio/归档/民谣/track-02.mp3", "audio/mpeg", 100, 1);
  insert.run("audio", "星辰终曲", "其他", "", "track-03.mp3", "audio/现场/track-03.mp3", "audio/mpeg", 100, 1);

  const result = listMediaAssets({ kind: "audio", query: "古典 星辰", pageSize: 1 });
  assert.equal(result.totalAssets, 1);
  assert.equal(result.totalPages, 1);
  assert.equal(result.assets[0].title, "星辰序曲");
  assert.deepEqual(
    listMediaFolders("audio").filter((folder) => folder.path.includes("归档")).map((folder) => folder.path),
    ["归档", "归档/古典", "归档/民谣"],
  );
});

test("manages video tags and filters tagged videos before pagination", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO media_assets
      (kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms, play_count)
     VALUES ('video', ?, ?, ?, 'video/mp4', 100, 1, ?)`,
  );
  const firstId = Number(insert.run("第一集", "one.mp4", "video/one.mp4", 12).lastInsertRowid);
  const secondId = Number(insert.run("第二集", "two.mp4", "video/two.mp4", 8).lastInsertRowid);
  insert.run("访谈", "three.mp4", "video/three.mp4", 3);

  const story = createVideoTag("剧情", "故事类视频");
  const interview = createVideoTag("访谈");
  assert.equal(setVideoTagsForAssets([firstId, secondId], [story.id]), 2);
  assert.equal(setVideoTagsForAssets([secondId], [story.id, interview.id]), 1);

  const tags = listVideoTags();
  assert.equal(tags.totalTags, 2);
  assert.equal(tags.tags.find((tag) => tag.id === story.id)?.videoCount, 2);
  assert.deepEqual(listVideoTagsForAsset(secondId).map((tag) => tag.name), ["剧情", "访谈"]);
  assert.equal(listVideoTags({ query: "故事" }).tags[0]?.id, story.id);
  assert.deepEqual(
    listMediaAssets({ kind: "video", videoTagId: story.id, recursive: true }).assets.map((asset) => asset.title),
    ["第一集", "第二集"],
  );
  assert.equal(updateVideoTag(story.id, "剧情片", "故事类视频", 10, false), true);
  assert.equal(listVideoTags().tags.some((tag) => tag.id === story.id), false);
  assert.equal(listVideoTags({ includeHidden: true }).tags.find((tag) => tag.id === story.id)?.slug, story.slug);
});

test("tracks media preparation independently from public list requests", (t) => {
  withTempDatabase(t);
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO media_assets
      (kind, title, file_name, stored_name, mime_type, size_bytes, mtime_ms, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const videoId = Number(insert
    .run("video", "视频", "video.mp4", "video/video.mp4", "video/mp4", 100, 10, 60)
    .lastInsertRowid);
  const audioId = Number(insert
    .run("audio", "音频", "audio.mp3", "audio/audio.mp3", "audio/mpeg", 50, 10, null)
    .lastInsertRowid);

  assert.deepEqual(
    new Set(listMediaAssetsNeedingPreparation().map((asset) => asset.id)),
    new Set([videoId, audioId]),
  );
  assert.equal(reconcileMediaPreparationJobs(33, 1_000), 2);
  const firstJob = claimMediaPreparationJob(1_000);
  assert.equal(firstJob?.mediaId, videoId);
  assert.equal(failMediaPreparationJob(firstJob!, new Error("temporary failure"), 1_000), "pending");
  assert.equal(getMediaPreparationJob(videoId)?.nextRunAt, 16_000);
  const secondJob = claimMediaPreparationJob(1_000);
  assert.equal(secondJob?.mediaId, audioId);
  assert.equal(completeMediaPreparationJob(secondJob!), true);
  assert.equal(claimMediaPreparationJob(15_999), null);
  const retriedJob = claimMediaPreparationJob(16_000);
  assert.equal(retriedJob?.mediaId, videoId);
  assert.equal(retriedJob?.attempts, 1);
  assert.equal(completeMediaPreparationJob(retriedJob!), true);
  assert.equal(saveMediaThumbnailVersion(videoId, mediaThumbnailVersion(10, 33)), true);
  assert.equal(saveMediaDuration(audioId, 30), true);
  assert.equal(reconcileMediaPreparationJobs(33), 0);
  assert.equal(getMediaPreparationJob(videoId), null);
  assert.equal(getMediaPreparationJob(audioId), null);
  assert.deepEqual(listMediaAssetsNeedingPreparation(), []);
  assert.deepEqual(listMediaAssetsNeedingPreparation(1_000, 40).map((asset) => asset.id), [videoId]);
});
