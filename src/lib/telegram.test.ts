import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import { createStationThread } from "./station";
import { getTelegramConfig } from "./telegram-config";
import { bindTelegramLinkToken, createTelegramLinkUrl, getTelegramUserLink } from "./telegram-links";

const ENV_NAMES = [
  "DATABASE_PATH",
  "SITE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "TELEGRAM_ADMIN_CHAT_IDS",
  "TELEGRAM_ADMIN_USER_IDS",
] as const;

function setup(t: TestContext) {
  const previous = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-telegram-"));
  Object.assign(process.env, {
    DATABASE_PATH: path.join(root, "novels.db"),
    SITE_URL: "https://reader.example.com",
    TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG",
    TELEGRAM_BOT_USERNAME: "reader_notice_bot",
    TELEGRAM_WEBHOOK_SECRET: "telegram_webhook_secret_123456",
    TELEGRAM_ADMIN_CHAT_IDS: "-10001,-10002",
    TELEGRAM_ADMIN_USER_IDS: "123,456",
  });
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    for (const name of ENV_NAMES) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test("telegram stays optional and parses explicit webhook settings", () => {
  assert.equal(getTelegramConfig({} as NodeJS.ProcessEnv), null);
  const config = getTelegramConfig({
    TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG",
    TELEGRAM_BOT_USERNAME: "reader_notice_bot",
    TELEGRAM_WEBHOOK_SECRET: "telegram_webhook_secret_123456",
    TELEGRAM_ADMIN_CHAT_IDS: "-10001,invalid,-10001",
    TELEGRAM_ADMIN_USER_IDS: "123,456",
    SITE_URL: "https://reader.example.com/path",
  } as unknown as NodeJS.ProcessEnv)!;
  assert.deepEqual(config.adminChatIds, ["-10001"]);
  assert.deepEqual([...config.adminUserIds], [123, 456]);
  assert.equal(config.webhookUrl, "https://reader.example.com/api/telegram/webhook");
});

test("binds a user and queues station notifications without blocking station writes", (t) => {
  setup(t);
  const db = getDb();
  const userId = Number(db.prepare(
    "INSERT INTO users (username, display_name, password_hash) VALUES ('reader', '读者', 'hash')",
  ).run().lastInsertRowid);
  const url = createTelegramLinkUrl(userId)!;
  const token = new URL(url).searchParams.get("start")!.slice("link_".length);
  assert.deepEqual(bindTelegramLinkToken({ token, chatId: "777", username: "reader_tg" }), {
    ok: true,
    userId,
  });
  assert.equal(getTelegramUserLink(userId)?.username, "reader_tg");

  createStationThread(userId, "播放问题", "视频无法开始播放");
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM telegram_outbox WHERE status = 'pending'").get() as { count: number }).count,
    2,
  );
});
