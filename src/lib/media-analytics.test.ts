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

    const insertNovel = db.prepare(
      "INSERT INTO novels (title, file_name, relative_path, size_bytes, mtime_ms) VALUES (?, ?, ?, 10, 1)",
    );
    const insertHistory = db.prepare(
      `INSERT INTO user_reading_history (user_id, novel_id, title, visit_count, last_read_at)
       VALUES (?, ?, ?, 1, ?)`,
    );
    for (let index = 1; index <= 21; index += 1) {
      const title = `分页小说 ${String(index).padStart(2, "0")}`;
      const novel = insertNovel.run(title, `${index}.txt`, `${index}.txt`);
      insertHistory.run(userId, Number(novel.lastInsertRowid), title, `2099-01-01 00:00:${String(index).padStart(2, "0")}`);
    }
    const firstHistoryPage = users.listBrowseHistoryPage(userId, { page: 1, pageSize: 10 });
    const secondHistoryPage = users.listBrowseHistoryPage(userId, { page: 2, pageSize: 10 });
    assert.equal(firstHistoryPage.totalItems, 22);
    assert.equal(firstHistoryPage.totalPages, 3);
    assert.equal(firstHistoryPage.items.length, 10);
    assert.equal(secondHistoryPage.items.length, 10);
    assert.equal(firstHistoryPage.items.some((item) => secondHistoryPage.items.some((other) => other.key === item.key)), false);

    const insertLogin = db.prepare(
      "INSERT INTO user_login_records (user_id, username, ip, user_agent, logged_at) VALUES (?, 'media-user', ?, 'test', ?)",
    );
    for (let index = 1; index <= 25; index += 1) {
      insertLogin.run(userId, `203.0.113.${index}`, `2099-01-02 00:00:${String(index).padStart(2, "0")}`);
    }
    const firstLoginPage = users.listUserLoginRecordPage(userId, { page: 1, pageSize: 10 });
    const secondLoginPage = users.listUserLoginRecordPage(userId, { page: 2, pageSize: 10 });
    assert.equal(firstLoginPage.totalItems, 25);
    assert.equal(firstLoginPage.totalPages, 3);
    assert.equal(firstLoginPage.items.length, 10);
    assert.equal(secondLoginPage.items.length, 10);
    assert.equal(firstLoginPage.items.some((item) => secondLoginPage.items.some((other) => other.id === item.id)), false);

    assert.equal(users.deleteBrowseHistoryItem(userId, history[0].key), true);
    assert.equal(users.clearBrowseHistory(userId), 21);
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
