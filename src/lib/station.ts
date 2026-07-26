import { getDb } from "./db";

export type AnnouncementAudience = "public" | "member";
export type AnnouncementImportance = "normal" | "important";
export type AnnouncementStatus = "draft" | "published" | "archived";

export type Announcement = {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  importance: AnnouncementImportance;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StationThread = {
  id: number;
  userId: number;
  username: string;
  displayName: string;
  subject: string;
  status: "open" | "closed";
  unreadForUser: boolean;
  unreadForAdmin: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export type StationMessage = {
  id: number;
  threadId: number;
  authorRole: "user" | "admin";
  body: string;
  createdAt: string;
};

type AnnouncementRow = {
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  importance: AnnouncementImportance;
  status: AnnouncementStatus;
  published_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type StationThreadRow = {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  subject: string;
  status: "open" | "closed";
  user_last_read_message_id: number;
  admin_last_read_message_id: number;
  latest_admin_message_id: number | null;
  latest_user_message_id: number | null;
  last_message_at: string;
  created_at: string;
  updated_at: string;
};

type StationMessageRow = {
  id: number;
  thread_id: number;
  author_role: "user" | "admin";
  body: string;
  created_at: string;
};

export class StationInputError extends Error {}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    importance: row.importance,
    status: row.status,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStationThread(row: StationThreadRow): StationThread {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    subject: row.subject,
    status: row.status,
    unreadForUser: (row.latest_admin_message_id || 0) > row.user_last_read_message_id,
    unreadForAdmin: (row.latest_user_message_id || 0) > row.admin_last_read_message_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toStationMessage(row: StationMessageRow): StationMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorRole: row.author_role,
    body: row.body,
    createdAt: row.created_at,
  };
}

function cleanTitle(value: unknown, label = "标题"): string {
  const title = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  if (!title) {
    throw new StationInputError(`${label}不能为空`);
  }
  return title;
}

function cleanBody(value: unknown): string {
  const body = String(value || "").trim().slice(0, 4_000);
  if (!body) {
    throw new StationInputError("内容不能为空");
  }
  return body;
}

function visibleAnnouncementWhere(authenticated: boolean): string {
  return `status = 'published'
    AND published_at IS NOT NULL
    AND datetime(published_at) <= CURRENT_TIMESTAMP
    AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
    ${authenticated ? "" : "AND audience = 'public'"}`;
}

export function getHomeAnnouncement(authenticated: boolean): Announcement | null {
  const row = getDb()
    .prepare(
      `SELECT id, title, body, audience, importance, status, published_at, expires_at, created_at, updated_at
       FROM announcements
       WHERE ${visibleAnnouncementWhere(authenticated)}
       ORDER BY CASE importance WHEN 'important' THEN 0 ELSE 1 END,
                published_at DESC, id DESC
       LIMIT 1`,
    )
    .get() as AnnouncementRow | undefined;
  return row ? toAnnouncement(row) : null;
}

export function listVisibleAnnouncements(authenticated: boolean, limit = 50): Announcement[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  return (getDb()
    .prepare(
      `SELECT id, title, body, audience, importance, status, published_at, expires_at, created_at, updated_at
       FROM announcements
       WHERE ${visibleAnnouncementWhere(authenticated)}
       ORDER BY CASE importance WHEN 'important' THEN 0 ELSE 1 END,
                published_at DESC, id DESC
       LIMIT ?`,
    )
    .all(safeLimit) as AnnouncementRow[]).map(toAnnouncement);
}

export function getVisibleAnnouncement(
  id: number,
  options: { authenticated?: boolean; admin?: boolean } = {},
): Announcement | null {
  const where = options.admin ? "id = ?" : `id = ? AND ${visibleAnnouncementWhere(Boolean(options.authenticated))}`;
  const row = getDb()
    .prepare(
      `SELECT id, title, body, audience, importance, status, published_at, expires_at, created_at, updated_at
       FROM announcements WHERE ${where}`,
    )
    .get(id) as AnnouncementRow | undefined;
  return row ? toAnnouncement(row) : null;
}

export function listAdminAnnouncements(limit = 100): Announcement[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 300);
  return (getDb()
    .prepare(
      `SELECT id, title, body, audience, importance, status, published_at, expires_at, created_at, updated_at
       FROM announcements
       ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                updated_at DESC, id DESC
       LIMIT ?`,
    )
    .all(safeLimit) as AnnouncementRow[]).map(toAnnouncement);
}

export function saveAnnouncement(input: {
  id?: number;
  title: unknown;
  body: unknown;
  audience?: unknown;
  importance?: unknown;
  status?: unknown;
  publishedAt?: string | null;
  expiresAt?: string | null;
}): Announcement {
  const id = Number(input.id || 0);
  const title = cleanTitle(input.title);
  const body = cleanBody(input.body);
  const audience: AnnouncementAudience = input.audience === "member" ? "member" : "public";
  const importance: AnnouncementImportance = input.importance === "important" ? "important" : "normal";
  const status: AnnouncementStatus = input.status === "published" || input.status === "archived" ? input.status : "draft";
  const publishedAt = status === "published"
    ? input.publishedAt || new Date().toISOString()
    : input.publishedAt || null;
  const expiresAt = input.expiresAt || null;
  const db = getDb();

  if (Number.isInteger(id) && id > 0) {
    const changed = db.prepare(
      `UPDATE announcements
       SET title = ?, body = ?, audience = ?, importance = ?, status = ?,
           published_at = ?, expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(title, body, audience, importance, status, publishedAt, expiresAt, id).changes;
    if (!changed) {
      throw new StationInputError("公告不存在");
    }
    return getVisibleAnnouncement(id, { admin: true })!;
  }
  const result = db.prepare(
    `INSERT INTO announcements
      (title, body, audience, importance, status, published_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(title, body, audience, importance, status, publishedAt, expiresAt);
  return getVisibleAnnouncement(Number(result.lastInsertRowid), { admin: true })!;
}

export function deleteAnnouncement(id: number): boolean {
  return getDb().prepare("DELETE FROM announcements WHERE id = ?").run(id).changes > 0;
}

export function deleteStationThread(id: number): boolean {
  return getDb().prepare("DELETE FROM station_threads WHERE id = ?").run(id).changes > 0;
}

export function markAnnouncementRead(userId: number, announcementId: number) {
  getDb().prepare(
    `INSERT INTO announcement_reads (announcement_id, user_id)
     VALUES (?, ?)
     ON CONFLICT(announcement_id, user_id) DO UPDATE SET read_at = CURRENT_TIMESTAMP`,
  ).run(announcementId, userId);
}

const THREAD_SELECT = `
  SELECT t.id, t.user_id, u.username, u.display_name, t.subject, t.status,
         t.user_last_read_message_id, t.admin_last_read_message_id,
         (SELECT MAX(m.id) FROM station_messages m WHERE m.thread_id = t.id AND m.author_role = 'admin') AS latest_admin_message_id,
         (SELECT MAX(m.id) FROM station_messages m WHERE m.thread_id = t.id AND m.author_role = 'user') AS latest_user_message_id,
         t.last_message_at, t.created_at, t.updated_at
  FROM station_threads t
  INNER JOIN users u ON u.id = t.user_id`;

export function listUserStationThreads(userId: number): StationThread[] {
  return (getDb()
    .prepare(`${THREAD_SELECT} WHERE t.user_id = ? ORDER BY t.last_message_at DESC, t.id DESC LIMIT 100`)
    .all(userId) as StationThreadRow[]).map(toStationThread);
}

export function listAdminStationThreads(limit = 200): StationThread[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  return (getDb()
    .prepare(
      `${THREAD_SELECT}
       ORDER BY
         CASE WHEN (SELECT COALESCE(MAX(m.id), 0) FROM station_messages m WHERE m.thread_id = t.id AND m.author_role = 'user')
                    > t.admin_last_read_message_id THEN 0 ELSE 1 END,
         CASE t.status WHEN 'open' THEN 0 ELSE 1 END,
         t.last_message_at DESC, t.id DESC
       LIMIT ?`,
    )
    .all(safeLimit) as StationThreadRow[]).map(toStationThread);
}

export function getStationThread(
  id: number,
  options: { userId?: number; admin?: boolean } = {},
): StationThread | null {
  const filter = options.admin ? "t.id = ?" : "t.id = ? AND t.user_id = ?";
  const args = options.admin ? [id] : [id, options.userId || 0];
  const row = getDb().prepare(`${THREAD_SELECT} WHERE ${filter}`).get(...args) as StationThreadRow | undefined;
  return row ? toStationThread(row) : null;
}

export function listStationMessages(threadId: number): StationMessage[] {
  return (getDb()
    .prepare(
      `SELECT id, thread_id, author_role, body, created_at
       FROM station_messages WHERE thread_id = ? ORDER BY id ASC`,
    )
    .all(threadId) as StationMessageRow[]).map(toStationMessage);
}

export function createStationThread(userId: number, subjectValue: unknown, bodyValue: unknown): number {
  const subject = cleanTitle(subjectValue, "主题");
  const body = cleanBody(bodyValue);
  const db = getDb();
  const eligible = db.prepare("SELECT 1 AS found FROM users WHERE id = ? AND status = 'active'").get(userId);
  if (!eligible) {
    throw new StationInputError("账户不可用");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const thread = db.prepare("INSERT INTO station_threads (user_id, subject) VALUES (?, ?)").run(userId, subject);
    const threadId = Number(thread.lastInsertRowid);
    const message = db.prepare(
      "INSERT INTO station_messages (thread_id, author_role, author_user_id, body) VALUES (?, 'user', ?, ?)",
    ).run(threadId, userId, body);
    db.prepare(
      `UPDATE station_threads
       SET user_last_read_message_id = ?, admin_last_read_message_id = 0,
           last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(Number(message.lastInsertRowid), threadId);
    db.exec("COMMIT");
    return threadId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function addStationReply(input: {
  threadId: number;
  body: unknown;
  authorRole: "user" | "admin";
  userId?: number;
}): boolean {
  const body = cleanBody(input.body);
  const thread = getStationThread(input.threadId, input.authorRole === "admin"
    ? { admin: true }
    : { userId: input.userId });
  if (!thread || thread.status === "closed") {
    return false;
  }

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare(
      `INSERT INTO station_messages (thread_id, author_role, author_user_id, body)
       VALUES (?, ?, ?, ?)`,
    ).run(input.threadId, input.authorRole, input.authorRole === "user" ? input.userId || null : null, body);
    const readColumn = input.authorRole === "user" ? "user_last_read_message_id" : "admin_last_read_message_id";
    db.prepare(
      `UPDATE station_threads
       SET ${readColumn} = ?, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(Number(result.lastInsertRowid), input.threadId);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function markStationThreadRead(threadId: number, reader: "user" | "admin", userId?: number) {
  const thread = getStationThread(threadId, reader === "admin" ? { admin: true } : { userId });
  if (!thread) return;
  const latest = getDb()
    .prepare("SELECT COALESCE(MAX(id), 0) AS id FROM station_messages WHERE thread_id = ?")
    .get(threadId) as { id: number };
  const column = reader === "admin" ? "admin_last_read_message_id" : "user_last_read_message_id";
  getDb().prepare(`UPDATE station_threads SET ${column} = ? WHERE id = ?`).run(latest.id, threadId);
}

export function markAllUserMessagesRead(userId: number) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id)
       SELECT a.id, ?
       FROM announcements a
       WHERE ${visibleAnnouncementWhere(true)}`,
    ).run(userId);
    db.prepare(
      `UPDATE station_threads
       SET user_last_read_message_id = COALESCE(
         (SELECT MAX(m.id) FROM station_messages m WHERE m.thread_id = station_threads.id),
         user_last_read_message_id
       )
       WHERE user_id = ?`,
    ).run(userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setStationThreadStatus(id: number, status: "open" | "closed"): boolean {
  return getDb()
    .prepare("UPDATE station_threads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, id).changes > 0;
}

export function countUserUnreadMessages(userId: number): number {
  const unread = getDb()
    .prepare(
      `SELECT
         (
           SELECT COUNT(*)
           FROM announcements a
           WHERE ${visibleAnnouncementWhere(true)}
             AND NOT EXISTS (
               SELECT 1 FROM announcement_reads ar
               WHERE ar.announcement_id = a.id AND ar.user_id = ?
             )
         ) + (
           SELECT COUNT(*)
           FROM station_threads t
           WHERE t.user_id = ?
             AND EXISTS (
               SELECT 1 FROM station_messages m
               WHERE m.thread_id = t.id AND m.author_role = 'admin' AND m.id > t.user_last_read_message_id
             )
         ) AS count`,
    )
    .get(userId, userId) as { count: number };
  return unread.count;
}
