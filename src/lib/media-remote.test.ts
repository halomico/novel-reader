import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createMediaNodeServer } from "./media-node-server";

test("requires a separate media-node control secret", () => {
  assert.throws(
    () => createMediaNodeServer({
      root: path.join(os.tmpdir(), "unused-media-node"),
      signingSecret: "0123456789abcdef0123456789abcdef",
      controlSecret: "too-short",
    }),
    /MEDIA_CONTROL_SECRET/,
  );
});

test("uploads directly to the media node while the main app keeps only the index", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-remote-media-"));
  const mediaRoot = path.join(tempDir, "media-node");
  const mainMediaRoot = path.join(tempDir, "main-media");
  const signingSecret = "0123456789abcdef0123456789abcdef";
  const controlSecret = "abcdef0123456789abcdef0123456789";
  const server = createMediaNodeServer({ root: mediaRoot, signingSecret, controlSecret });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const nodeOrigin = `http://127.0.0.1:${address.port}`;
  const browserOrigin = "https://reader.example.com";
  const environmentNames = [
    "DATABASE_PATH",
    "ADMIN_SETTINGS_PATH",
    "MEDIA_DIR",
    "MEDIA_STORAGE_MODE",
    "MEDIA_PUBLIC_URL",
    "MEDIA_CONTROL_URL",
    "MEDIA_SIGNING_SECRET",
    "MEDIA_CONTROL_SECRET",
    "MEDIA_URL_TTL_SECONDS",
  ] as const;
  const previousEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
  process.env.DATABASE_PATH = path.join(tempDir, "novels.db");
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "settings.json");
  process.env.MEDIA_DIR = mainMediaRoot;
  process.env.MEDIA_STORAGE_MODE = "remote";
  process.env.MEDIA_PUBLIC_URL = nodeOrigin;
  process.env.MEDIA_CONTROL_URL = nodeOrigin;
  process.env.MEDIA_SIGNING_SECRET = signingSecret;
  process.env.MEDIA_CONTROL_SECRET = controlSecret;
  process.env.MEDIA_URL_TTL_SECONDS = "600";

  let database: { close: () => void } | null = null;
  try {
    const media = await import("./media");
    const delivery = await import("./media-delivery");
    const client = await import("./media-node-client");
    const uploads = await import("./media-upload-service");
    const { getDb } = await import("./db");
    database = getDb();

    assert.equal(await client.createRemoteMediaFolder("file", "归档"), "归档");
    const content = Buffer.from("remote-media-only");
    const started = await uploads.startMediaStorageUpload({
      kind: "file",
      title: "远程资料",
      description: "直传测试",
      folder: "归档",
      fileName: "source.txt",
      mimeType: "text/plain",
      sizeBytes: content.length,
    }, browserOrigin);

    const preflight = await fetch(started.uploadUrl, {
      method: "OPTIONS",
      headers: {
        Origin: browserOrigin,
        "Access-Control-Request-Headers": "authorization,content-type,x-upload-offset",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), browserOrigin);

    const uploadChunk = () => fetch(started.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${started.uploadToken}`,
        Origin: browserOrigin,
        "Content-Type": "application/octet-stream",
        "X-Upload-Offset": "0",
      },
      body: content,
    });
    const duplicateChunks = await Promise.all([uploadChunk(), uploadChunk()]);
    assert.deepEqual(duplicateChunks.map((response) => response.status).sort(), [200, 409]);
    const successfulChunk = duplicateChunks.find((response) => response.ok);
    assert.ok(successfulChunk);
    assert.equal((await successfulChunk.json() as { nextOffset: number }).nextOffset, content.length);

    const status = await fetch(started.uploadUrl, {
      headers: {
        Authorization: `Bearer ${started.uploadToken}`,
        Origin: browserOrigin,
      },
    });
    assert.equal((await status.json() as { nextOffset: number }).nextOffset, content.length);

    const asset = await uploads.finishMediaStorageUpload(started.uploadId);
    assert.equal(asset.folder, "归档");
    assert.equal(asset.fileName, "远程资料.txt");
    assert.equal(await uploads.finishMediaStorageUpload(started.uploadId).then((item) => item.id), asset.id);
    assert.equal(fs.existsSync(path.join(mediaRoot, "file", "归档", "远程资料.txt")), true);
    assert.equal(fs.existsSync(mainMediaRoot), false);

    const signedPlaybackUrl = delivery.mediaDeliveryUrl(asset, true);
    const playback = await fetch(signedPlaybackUrl);
    assert.equal(playback.status, 200);
    assert.equal(playback.headers.get("cache-control"), "private, max-age=300");
    assert.equal(Buffer.from(await playback.arrayBuffer()).toString(), content.toString());
    const publicPlayback = await fetch(delivery.mediaDeliveryUrl(asset, false, { publiclyAccessible: true }));
    assert.equal(publicPlayback.status, 200);
    assert.equal(publicPlayback.headers.get("cache-control"), "public, max-age=3600, immutable");
    assert.equal(publicPlayback.headers.get("cloudflare-cdn-cache-control"), "public, max-age=3600");
    const range = await fetch(signedPlaybackUrl, { headers: { Range: "bytes=0-5" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-5/${content.length}`);
    assert.equal(Buffer.from(await range.arrayBuffer()).toString(), content.subarray(0, 6).toString());
    const staleIfRange = await fetch(signedPlaybackUrl, {
      headers: { Range: "bytes=0-5", "If-Range": '"stale"' },
    });
    assert.equal(staleIfRange.status, 200);
    assert.equal(Buffer.from(await staleIfRange.arrayBuffer()).toString(), content.toString());
    fs.utimesSync(
      path.join(mediaRoot, "file", "归档", "远程资料.txt"),
      new Date(),
      new Date(Date.now() + 5_000),
    );
    assert.equal((await fetch(signedPlaybackUrl)).status, 404);
    assert.deepEqual(await media.syncMediaLibrary({ force: true }), { added: 0, updated: 1, removed: 0 });

    assert.equal(await media.updateMediaAsset(asset.id, "整理资料", "", "已整理", "归档"), true);
    assert.equal(fs.existsSync(path.join(mediaRoot, "file", "归档", "整理资料.txt")), true);
    assert.equal(await media.renameMediaFolder("file", "归档", "公开资料"), "公开资料");
    assert.equal(media.getMediaAsset(asset.id)?.folder, "公开资料");

    const manifest = await client.readRemoteMediaManifest(true);
    assert.equal(manifest.files.some((item) => item.storedName === "file/公开资料/整理资料.txt"), true);
    assert.equal(manifest.folders.some((item) => item.path === "公开资料"), true);

    fs.rmSync(path.join(mediaRoot, "file", "公开资料", "整理资料.txt"));
    assert.deepEqual(await media.syncMediaLibrary({ force: true }), { added: 0, updated: 0, removed: 0 });
    assert.equal(media.getMediaAsset(asset.id)?.storedName, "file/公开资料/整理资料.txt");

    assert.deepEqual(await media.deleteMediaAssets([asset.id]), { deleted: 1, fileDeleteFailures: 0 });
    assert.equal(fs.existsSync(path.join(mediaRoot, "file", "公开资料", "整理资料.txt")), false);
    assert.equal(await media.deleteMediaFolder("file", "公开资料"), true);
  } finally {
    database?.close();
    server.close();
    await once(server, "close");
    for (const name of environmentNames) {
      const previous = previousEnvironment.get(name);
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
