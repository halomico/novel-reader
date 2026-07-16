import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("records media analytics and unified user browse history", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-media-analytics-"));
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousMediaDir = process.env.MEDIA_DIR;
  const previousSettingsPath = process.env.ADMIN_SETTINGS_PATH;
  process.env.DATABASE_PATH = path.join(tempDir, "novels.db");
  process.env.MEDIA_DIR = path.join(tempDir, "media");
  process.env.ADMIN_SETTINGS_PATH = path.join(tempDir, "settings.json");
  fs.writeFileSync(process.env.ADMIN_SETTINGS_PATH, JSON.stringify({ analyticsEnabled: true }));
  let closeDatabase: (() => void) | null = null;

  try {
    const analytics = await import("./analytics");
    const media = await import("./media");
    const users = await import("./users");
    const { getDb } = await import("./db");
    const db = getDb();
    closeDatabase = () => db.close();

    const audioDirectory = path.join(process.env.MEDIA_DIR, "audio", "测试专辑");
    fs.mkdirSync(audioDirectory, { recursive: true });
    fs.writeFileSync(path.join(audioDirectory, "analytics.mp3"), "ID3-analytics-media-test");
    await media.syncMediaLibrary({ force: true });
    const asset = media.listMediaAssets({ kind: "audio", folder: "测试专辑" }).assets[0];
    const userResult = db
      .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('media-user', '媒体用户', 'test-hash')")
      .run();
    const userId = Number(userResult.lastInsertRowid);
    const requestHeaders = new Headers({
      "cf-connecting-ip": "203.0.113.8",
      "cf-ipcountry": "CN",
      referer: "https://example.test/library",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36",
    });

    analytics.recordAnalyticsEvent({
      headers: requestHeaders,
      userId,
      eventType: "audio_view",
      path: `/media/${asset.id}`,
      referrer: requestHeaders.get("referer"),
      mediaId: asset.id,
    });
    users.recordMediaHistory(userId, asset);
    users.recordMediaHistory(userId, asset);

    const overview = analytics.getAnalyticsOverview("24h");
    assert.equal(overview.totalViews, 1);
    assert.equal(overview.topContent[0].label, asset.title);
    assert.equal(overview.realtime[0].contentType, "audio");
    assert.equal(overview.realtime[0].contentTitle, asset.title);

    const history = users.listBrowseHistory(userId);
    assert.equal(history.length, 1);
    assert.equal(history[0].source, "audio");
    assert.equal(history[0].visitCount, 2);
    assert.equal(users.getUserById(userId)?.historyVisible, true);
    assert.equal(users.updateUserHistoryVisibility(userId, false), true);
    assert.equal(users.listBrowseHistory(userId).length, 1);
    assert.equal(users.hideBrowseHistoryItem(userId, history[0].key), true);
    assert.equal(users.listBrowseHistory(userId, { includeHidden: false }).length, 0);
    assert.equal(users.listBrowseHistory(userId).length, 1);
    assert.equal(users.deleteBrowseHistoryItem(userId, history[0].key), true);
    assert.equal(users.listBrowseHistory(userId).length, 0);
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
