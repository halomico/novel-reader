import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import { getDb } from "./db";
import {
  addStationReply,
  countUserUnreadMessages,
  createStationThread,
  deleteStationThread,
  getHomeAnnouncement,
  getStationThread,
  listStationMessages,
  listUserStationThreads,
  listVisibleAnnouncements,
  markAllUserMessagesRead,
  markAnnouncementRead,
  markStationThreadRead,
  saveAnnouncement,
} from "./station";

function withTempDatabase(t: TestContext) {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "novel-reader-station-"));
  process.env.DATABASE_PATH = path.join(root, "novels.db");
  const state = globalThis as typeof globalThis & { novelReaderDb?: DatabaseSync };
  state.novelReaderDb?.close();
  delete state.novelReaderDb;
  t.after(() => {
    state.novelReaderDb?.close();
    delete state.novelReaderDb;
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function seedUser(): number {
  return Number(getDb()
    .prepare("INSERT INTO users (username, display_name, password_hash) VALUES ('member', '成员', 'hash')")
    .run().lastInsertRowid);
}

test("separates public and member announcements and tracks reads", (t) => {
  withTempDatabase(t);
  const userId = seedUser();
  const publishedAt = new Date(Date.now() - 60_000).toISOString();
  const publicAnnouncement = saveAnnouncement({
    title: "公开公告",
    body: "公开内容",
    audience: "public",
    status: "published",
    publishedAt,
  });
  saveAnnouncement({
    title: "成员公告",
    body: "成员内容",
    audience: "member",
    status: "published",
    publishedAt,
  });

  assert.equal(getHomeAnnouncement(false)?.title, "公开公告");
  assert.deepEqual(listVisibleAnnouncements(false).map((item) => item.title), ["公开公告"]);
  assert.deepEqual(listVisibleAnnouncements(true).map((item) => item.title).sort(), ["公开公告", "成员公告"]);
  assert.equal(countUserUnreadMessages(userId), 2);
  markAnnouncementRead(userId, publicAnnouncement.id);
  assert.equal(countUserUnreadMessages(userId), 1);
  markAllUserMessagesRead(userId);
  assert.equal(countUserUnreadMessages(userId), 0);
});

test("keeps station messages private and updates unread state", (t) => {
  withTempDatabase(t);
  const userId = seedUser();
  const threadId = createStationThread(userId, "标签问题", "这里有一处错误");
  assert.equal(listUserStationThreads(userId)[0].unreadForUser, false);
  assert.equal(getStationThread(threadId, { admin: true })?.unreadForAdmin, true);

  markStationThreadRead(threadId, "admin");
  assert.equal(getStationThread(threadId, { admin: true })?.unreadForAdmin, false);
  assert.equal(addStationReply({ threadId, authorRole: "admin", body: "已经处理" }), true);
  assert.equal(getStationThread(threadId, { userId })?.unreadForUser, true);
  assert.equal(listStationMessages(threadId).length, 2);

  markStationThreadRead(threadId, "user", userId);
  assert.equal(getStationThread(threadId, { userId })?.unreadForUser, false);
  assert.equal(getStationThread(threadId, { userId: userId + 1 }), null);
  assert.equal(deleteStationThread(threadId), true);
  assert.equal(getStationThread(threadId, { admin: true }), null);
});
