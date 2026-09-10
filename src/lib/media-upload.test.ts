import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { MediaAsset } from "@/domains/media/media-model";
import type { MediaUploadRepository } from "./media-upload";

function asset(id: number, input: Parameters<MediaUploadRepository["createAsset"]>[0]): MediaAsset {
  const now = new Date().toISOString();
  return {
    id,
    kind: input.kind,
    storageNodeId: input.storageNodeId || null,
    categoryId: input.kind === "video" ? Number(input.categoryId) || null : null,
    title: input.title,
    artist: input.kind === "file" ? "" : input.artist || "",
    description: input.description || "",
    fileName: input.fileName,
    storedName: input.storedName,
    folder: input.storedName.split("/").slice(1, -1).join("/"),
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    mtimeMs: input.mtimeMs || 0,
    durationSeconds: input.durationSeconds || null,
    thumbnailVersion: 0,
    customCoverKey: null,
    playbackFormat: "mp4",
    playbackVersion: "",
    playbackManifestPath: null,
    playbackStatus: "none",
    playbackError: "",
    playbackPublishedAt: null,
    playCount: 0,
    recommendCount: 0,
    downloadCount: 0,
    publishedAt: now,
    contentUpdatedAt: now,
    newUntil: null,
    playSodaPrice: 0,
    downloadSodaPrice: 1,
    createdAt: now,
    updatedAt: now,
  };
}

test("local chunk uploads are resumable, idempotent, and avoid indexed file-name collisions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-media-upload-"));
  const previousMediaDir = process.env.MEDIA_DIR;
  const previousStorageMode = process.env.MEDIA_STORAGE_MODE;
  const previousTranscodeProfile = process.env.VIDEO_TRANSCODE_PROFILE;
  process.env.MEDIA_DIR = path.join(tempDir, "media");
  process.env.MEDIA_STORAGE_MODE = "local";
  process.env.VIDEO_TRANSCODE_PROFILE = "source";

  const assets = new Map<number, MediaAsset>();
  let nextId = 1;
  const repository: MediaUploadRepository = {
    resolveVideoCategoryId: async (value) => value === null || value === undefined || value === "" ? null : Number(value),
    getAsset: async (id) => assets.get(id) || null,
    indexedStoredNames: async () => new Set([...assets.values()].map((item) => item.storedName)),
    createAsset: async (input) => {
      const created = asset(nextId++, input);
      assets.set(created.id, created);
      return created;
    },
    deleteAssets: async (ids) => {
      for (const id of ids) assets.delete(id);
    },
  };

  try {
    const upload = await import("./media-upload");
    const storage = await import("@/domains/media/media-storage-model");
    storage.ensureLocalMediaDirectories();
    fs.mkdirSync(path.join(process.env.MEDIA_DIR, "audio", "测试专辑"), { recursive: true });
    const source = Buffer.from("ID3-media-test");
    const started = await upload.startMediaUpload({
      kind: "audio",
      title: "测试音频",
      artist: "测试作者",
      description: "分片上传测试",
      folder: "测试专辑",
      fileName: "sample.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: source.length,
    }, repository);
    assert.equal(await upload.appendMediaUploadChunk(started.uploadId, 0, source.subarray(0, 5)), 5);
    assert.equal(await upload.getMediaUploadOffset(started.uploadId), 5);
    assert.equal(await upload.appendMediaUploadChunk(started.uploadId, 5, source.subarray(5)), source.length);

    const created = await upload.finishMediaUpload(started.uploadId, repository);
    assert.equal(created.fileName, "测试音频.mp3");
    assert.equal(created.folder, "测试专辑");
    assert.equal(fs.readFileSync(storage.mediaFilePath(created.storedName), "utf8"), source.toString());
    assert.equal((await upload.finishMediaUpload(started.uploadId, repository)).id, created.id);

    const duplicate = await upload.startMediaUpload({
      kind: "audio",
      title: "测试音频",
      folder: "测试专辑",
      fileName: "sample.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: source.length,
      description: "",
    }, repository);
    await upload.appendMediaUploadChunk(duplicate.uploadId, 0, source);
    const second = await upload.finishMediaUpload(duplicate.uploadId, repository);
    assert.equal(second.fileName, "测试音频 (2).mp3");

    const cancelled = await upload.startMediaUpload({
      kind: "audio",
      title: "取消任务",
      folder: "测试专辑",
      fileName: "cancel.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: source.length,
      description: "",
    }, repository);
    assert.equal(await upload.cancelMediaUpload(cancelled.uploadId, repository), true);
    assert.equal(await upload.cancelMediaUpload(cancelled.uploadId, repository), false);
  } finally {
    if (previousMediaDir === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previousMediaDir;
    if (previousStorageMode === undefined) delete process.env.MEDIA_STORAGE_MODE;
    else process.env.MEDIA_STORAGE_MODE = previousStorageMode;
    if (previousTranscodeProfile === undefined) delete process.env.VIDEO_TRANSCODE_PROFILE;
    else process.env.VIDEO_TRANSCODE_PROFILE = previousTranscodeProfile;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
