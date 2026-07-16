import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("uploads media in chunks, records it, and removes the stored file", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-media-"));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousMediaDir = process.env.MEDIA_DIR;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "novels.db");
  process.env.MEDIA_DIR = path.join(tempDir, "media");
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "settings.json");
  let closeDatabase: (() => void) | null = null;

  try {
    const upload = await import("./media-upload");
    const media = await import("./media");
    const delivery = await import("./media-delivery");
    const { getDb } = await import("./db");
    const db = getDb();
    closeDatabase = () => db.close();
    const legacyStoredName = "legacy-flat.mp3";
    fs.mkdirSync(process.env.MEDIA_DIR!, { recursive: true });
    fs.writeFileSync(path.join(process.env.MEDIA_DIR!, legacyStoredName), "ID3-legacy-media-test");
    const legacyResult = db
      .prepare(
        `INSERT INTO media_assets (kind, title, file_name, stored_name, mime_type, size_bytes)
         VALUES ('audio', '旧资源', 'legacy.mp3', ?, 'audio/mpeg', 21)`,
      )
      .run(legacyStoredName);
    await media.syncMediaLibrary({ force: true });
    const legacyAsset = media.getMediaAsset(Number(legacyResult.lastInsertRowid))!;
    assert.equal(legacyAsset.storedName.startsWith("audio/"), true);
    assert.equal(fs.existsSync(media.mediaFilePath(legacyAsset.storedName)), true);
    media.createMediaFolder("audio", "", "测试专辑");
    const source = Buffer.from("ID3-media-test");
    const started = upload.startMediaUpload({
      kind: "audio",
      title: "测试音频",
      artist: "测试作者",
      description: "分片上传测试",
      folder: "测试专辑",
      fileName: "sample.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: source.length,
    });
    assert.equal(upload.appendMediaUploadChunk(started.uploadId, 0, source.subarray(0, 5)), 5);
    assert.equal(upload.appendMediaUploadChunk(started.uploadId, 5, source.subarray(5)), source.length);

    const asset = upload.finishMediaUpload(started.uploadId);
    const storedPath = media.mediaFilePath(asset.storedName);
    assert.equal(asset.kind, "audio");
    assert.equal(asset.artist, "测试作者");
    assert.equal(asset.folder, "测试专辑");
    assert.equal(asset.fileName, "测试音频.mp3");
    assert.equal(fs.readFileSync(storedPath).toString(), source.toString());
    assert.equal(media.updateMediaAsset(asset.id, "新标题", "新作者", "新简介"), true);
    assert.equal(media.getMediaAsset(asset.id)?.artist, "新作者");
    assert.equal(media.getMediaAsset(asset.id)?.fileName, "新标题.mp3");
    assert.equal(fs.existsSync(storedPath), false);
    const currentAsset = media.getMediaAsset(asset.id)!;
    const deliveryUrl = delivery.mediaDeliveryUrl(currentAsset);
    assert.equal(delivery.resolveMediaDeliveryUri(deliveryUrl)?.asset.id, asset.id);
    assert.equal(delivery.resolveMediaDeliveryUri(deliveryUrl)?.download, false);
    assert.equal(delivery.resolveMediaDeliveryUri(deliveryUrl.replace(`id=${asset.id}`, "id=999999")), null);
    const secondSource = Buffer.from("ID3-second-media-test");
    const secondStarted = upload.startMediaUpload({
      kind: "audio",
      title: "",
      artist: "测试作者",
      description: "批量中的第二个文件",
      folder: "测试专辑",
      fileName: "second.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: secondSource.length,
    });
    assert.equal(upload.appendMediaUploadChunk(secondStarted.uploadId, 0, secondSource), secondSource.length);
    const secondAsset = upload.finishMediaUpload(secondStarted.uploadId);
    const secondStoredPath = media.mediaFilePath(secondAsset.storedName);
    assert.equal(secondAsset.title, "second");
    assert.equal(secondAsset.artist, "测试作者");
    assert.deepEqual(
      media.listMediaAssets({ kind: "audio", folder: "测试专辑", sortBy: "size", sortOrder: "asc" }).assets.map((item) => item.id),
      [asset.id, secondAsset.id],
    );
    assert.deepEqual(
      media.listMediaAssets({ kind: "audio", folder: "测试专辑", sortBy: "size", sortOrder: "desc" }).assets.map((item) => item.id),
      [secondAsset.id, asset.id],
    );
    const albumFolder = media.listMediaFolders("audio").find((item) => item.path === "测试专辑");
    assert.equal(albumFolder?.directAssets, 2);
    assert.equal(albumFolder?.totalSizeBytes, source.length + secondSource.length);
    assert.equal(media.listMediaAssets({ query: "测试作者" }).totalAssets, 1);
    assert.equal(media.renameMediaFolder("audio", "测试专辑", "已整理专辑"), "已整理专辑");
    assert.equal(media.getMediaAsset(asset.id)?.folder, "已整理专辑");
    assert.equal(media.listMediaAssets({ kind: "audio" }).totalAssets, 1);
    assert.equal(media.listMediaAssets({ kind: "audio", recursive: true }).totalAssets, 3);

    const externalFolder = path.join(process.env.MEDIA_DIR, "audio", "外部目录");
    fs.mkdirSync(externalFolder, { recursive: true });
    const externalPath = path.join(externalFolder, "external.mp3");
    fs.writeFileSync(externalPath, "ID3-external-media-test");
    assert.equal((await media.syncMediaLibrary({ force: true })).added, 1);
    const externalAsset = media.listMediaAssets({ kind: "audio", folder: "外部目录" }).assets[0];
    assert.equal(externalAsset.fileName, "external.mp3");
    const renamedExternalPath = path.join(externalFolder, "renamed.mp3");
    fs.renameSync(externalPath, renamedExternalPath);
    assert.equal((await media.syncMediaLibrary({ force: true })).updated, 1);
    assert.equal(media.getMediaAsset(externalAsset.id)?.fileName, "renamed.mp3");
    assert.equal(media.getMediaAsset(externalAsset.id)?.title, "renamed");
    fs.rmSync(renamedExternalPath);
    assert.equal((await media.syncMediaLibrary({ force: true })).removed, 1);
    assert.equal(media.getMediaAsset(externalAsset.id), null);

    assert.equal(media.incrementMediaPlayCount(asset.id), true);
    assert.equal(media.getMediaAsset(asset.id)?.playCount, 1);
    const renamedStoredPath = media.mediaFilePath(media.getMediaAsset(asset.id)!.storedName);
    const renamedSecondStoredPath = media.mediaFilePath(media.getMediaAsset(secondAsset.id)!.storedName);
    assert.deepEqual(media.deleteMediaAssets([asset.id, secondAsset.id, legacyAsset.id]), { deleted: 3, fileDeleteFailures: 0 });
    assert.equal(fs.existsSync(storedPath), false);
    assert.equal(fs.existsSync(secondStoredPath), false);
    assert.equal(fs.existsSync(renamedStoredPath), false);
    assert.equal(fs.existsSync(renamedSecondStoredPath), false);
    assert.equal(media.deleteMediaFolder("audio", "已整理专辑"), true);
  } finally {
    closeDatabase?.();
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousMediaDir === undefined) delete process.env.MEDIA_DIR;
    else process.env.MEDIA_DIR = previousMediaDir;
    if (previousSettingsPath === undefined) delete process.env.ADMIN_SETTINGS_PATH;
    else process.env.ADMIN_SETTINGS_PATH = previousSettingsPath;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
