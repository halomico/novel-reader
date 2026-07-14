import fs from "node:fs";
import path from "node:path";
import type { Novel } from "./books";
import { getDb } from "./db";
import type { MediaAsset, MediaKind } from "./media";

export type UserStatus = "active" | "disabled";

export type UserProfile = {
  id: number;
  username: string;
  displayName: string;
  avatarPath: string | null;
  status: UserStatus;
  searchRateLimitPerMinute: number | null;
  historyVisible: boolean;
  registrationIp: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
};

export type UserListResult = {
  users: UserProfile[];
  page: number;
  pageSize: number;
  totalUsers: number;
  totalPages: number;
  query: string;
};

export type ReadingHistoryItem = {
  id: number;
  novelId: number;
  title: string;
  segmentIndex: number;
  visitCount: number;
  lastReadAt: string;
  novelExists: boolean;
};

export type BrowseHistoryItem = {
  key: string;
  source: "novel" | MediaKind;
  itemId: number;
  title: string;
  segmentIndex: number;
  visitCount: number;
  lastAccessedAt: string;
  itemExists: boolean;
};

export type UserLoginRecord = {
  id: number;
  userId: number | null;
  username: string;
  ip: string;
  userAgent: string;
  loggedAt: string;
};

type UserRow = {
  id: number;
  username: string;
  display_name: string;
  avatar_path: string | null;
  status: string;
  search_rate_limit_per_minute: number | null;
  history_visible: number;
  registration_ip: string | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
  last_login_ip: string | null;
};

function normalizePage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (username.length < 3 || username.length > 32) {
    return "用户名长度需要在 3-32 个字符之间";
  }
  if (!/^[a-z0-9_-]+$/.test(username)) {
    return "用户名只能包含英文、数字、下划线和短横线";
  }
  return null;
}

export function validatePassword(value: string): string | null {
  if (value.length < 6 || value.length > 72) {
    return "密码长度需要在 6-72 个字符之间";
  }
  return null;
}

export function validateDisplayName(value: string): string | null {
  const displayName = value.trim();
  if (displayName.length < 1 || displayName.length > 40) {
    return "显示名称长度需要在 1-40 个字符之间";
  }
  return null;
}

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    status: row.status === "disabled" ? "disabled" : "active",
    searchRateLimitPerMinute: row.search_rate_limit_per_minute,
    historyVisible: row.history_visible === 1,
    registrationIp: row.registration_ip,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
  };
}

export function getUserById(id: number): UserProfile | null {
  const row = getDb()
    .prepare(
      `SELECT id, username, display_name, avatar_path, status, search_rate_limit_per_minute, history_visible, registration_ip, created_at, updated_at, last_login_at, last_login_ip
       FROM users
       WHERE id = ?`,
    )
    .get(id) as UserRow | undefined;

  return row ? toUserProfile(row) : null;
}

export function getUserPasswordRow(username: string): (UserRow & { password_hash: string }) | null {
  const row = getDb()
    .prepare(
      `SELECT id, username, display_name, password_hash, avatar_path, status, search_rate_limit_per_minute, history_visible, registration_ip, created_at, updated_at, last_login_at, last_login_ip
       FROM users
       WHERE username = ?`,
    )
    .get(normalizeUsername(username)) as (UserRow & { password_hash: string }) | undefined;

  return row || null;
}

export function createUserRecord(params: {
  username: string;
  displayName: string;
  passwordHash: string;
  status?: UserStatus;
  searchRateLimitPerMinute?: number | null;
  registrationIp?: string | null;
}): number {
  const info = getDb()
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, status, search_rate_limit_per_minute, registration_ip, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
    )
    .run(
      normalizeUsername(params.username),
      params.displayName.trim(),
      params.passwordHash,
      params.status || "active",
      params.searchRateLimitPerMinute ?? null,
      params.registrationIp || null,
    );

  return Number(info.lastInsertRowid);
}

export function countTodayRegistrationsForIp(ip: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM users WHERE registration_ip = ? AND date(created_at) = date('now')")
    .get(ip) as { count: number } | undefined;
  return row?.count || 0;
}

export function listUsers(params: { page?: number; q?: string; pageSize?: number }): UserListResult {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 30), 1), 200);
  const query = (params.q || "").trim();
  const where = query
    ? "WHERE username LIKE ? OR display_name LIKE ? OR COALESCE(last_login_ip, '') LIKE ? OR COALESCE(registration_ip, '') LIKE ?"
    : "";
  const bind = query ? [`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) AS count FROM users ${where}`).get(...bind) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const offset = (page - 1) * pageSize;
  const users = db
    .prepare(
      `SELECT id, username, display_name, avatar_path, status, search_rate_limit_per_minute, history_visible, registration_ip, created_at, updated_at, last_login_at, last_login_ip
       FROM users
       ${where}
       ORDER BY updated_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...bind, pageSize, offset) as UserRow[];

  return {
    users: users.map(toUserProfile),
    page,
    pageSize,
    totalUsers: total.count,
    totalPages,
    query,
  };
}

export function updateUserRecord(params: {
  id: number;
  displayName: string;
  status: UserStatus;
  searchRateLimitPerMinute: number | null;
  passwordHash?: string;
}): boolean {
  if (params.passwordHash) {
    const info = getDb()
      .prepare(
        `UPDATE users
         SET display_name = ?, status = ?, search_rate_limit_per_minute = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(params.displayName.trim(), params.status, params.searchRateLimitPerMinute, params.passwordHash, params.id);
    return Number(info.changes) > 0;
  }

  const info = getDb()
    .prepare(
      `UPDATE users
       SET display_name = ?, status = ?, search_rate_limit_per_minute = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
    .run(params.displayName.trim(), params.status, params.searchRateLimitPerMinute, params.id);
  return Number(info.changes) > 0;
}

export function updateUserStatus(userId: number, status: UserStatus): boolean {
  const info = getDb()
    .prepare("UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, userId);
  return Number(info.changes) > 0;
}

export function updateUserAvatar(userId: number, avatarPath: string | null) {
  getDb()
    .prepare("UPDATE users SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(avatarPath, userId);
}

export function updateUserDisplayName(userId: number, displayName: string) {
  getDb()
    .prepare("UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(displayName.trim(), userId);
}

export function updateUserHistoryVisibility(userId: number, visible: boolean): boolean {
  const info = getDb()
    .prepare("UPDATE users SET history_visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(visible ? 1 : 0, userId);
  return Number(info.changes) > 0;
}

export function getUserPasswordHashById(userId: number): string | null {
  const row = getDb().prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as { password_hash: string } | undefined;
  return row?.password_hash || null;
}

export function updateUserPasswordHash(userId: number, passwordHash: string) {
  getDb()
    .prepare("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(passwordHash, userId);
}

export function removeAvatarFile(avatarPath: string | null): boolean {
  if (!avatarPath?.startsWith("/avatars/")) {
    return false;
  }

  const avatarRoot = path.resolve(process.cwd(), "public", "avatars");
  const filePath = path.resolve(process.cwd(), "public", avatarPath.slice(1));
  if (filePath !== avatarRoot && filePath.startsWith(`${avatarRoot}${path.sep}`) && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function deleteUserIds(ids: number[]): number {
  const validIds = ids.filter((id) => Number.isInteger(id) && id > 0);
  if (!validIds.length) {
    return 0;
  }

  const db = getDb();
  const avatars = db
    .prepare(`SELECT avatar_path AS avatarPath FROM users WHERE id IN (${validIds.map(() => "?").join(",")})`)
    .all(...validIds) as Array<{ avatarPath: string | null }>;
  const deleteUser = db.prepare("DELETE FROM users WHERE id = ?");
  let deleted = 0;
  db.exec("BEGIN");
  try {
    for (const id of validIds) {
      deleted += Number(deleteUser.run(id).changes);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  for (const avatar of avatars) {
    removeAvatarFile(avatar.avatarPath);
  }
  return deleted;
}

export function recordUserLogin(userId: number, ip: string, userAgent: string) {
  const db = getDb();
  const row = db.prepare("SELECT username FROM users WHERE id = ?").get(userId) as { username: string } | undefined;
  if (!row) {
    return;
  }

  db.exec("BEGIN");
  try {
    db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP, last_login_ip = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(ip, userId);
    db.prepare(
      `INSERT INTO user_login_records (user_id, username, ip, user_agent)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, row.username, ip, userAgent.slice(0, 240));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordNovelVisit(novelId: number, ip = "", userAgent = "") {
  getDb()
    .prepare(
      `UPDATE novels
       SET visit_count = visit_count + 1,
           last_accessed_at = CURRENT_TIMESTAMP,
           last_accessed_ip = ?,
           last_accessed_user_agent = ?
       WHERE id = ?`,
    )
    .run(ip.slice(0, 64), userAgent.slice(0, 240), novelId);
}

export function recordReadingHistory(userId: number, book: Pick<Novel, "id" | "title">, segmentIndex: number) {
  const normalizedSegment = Number.isInteger(segmentIndex) && segmentIndex >= 0 ? segmentIndex : 0;
  getDb()
    .prepare(
      `INSERT INTO user_reading_history (user_id, novel_id, title, segment_index, visit_count, last_read_at)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, novel_id) DO UPDATE SET
         title = excluded.title,
         segment_index = excluded.segment_index,
         visit_count = user_reading_history.visit_count + 1,
         last_read_at = CURRENT_TIMESTAMP`,
    )
    .run(userId, book.id, book.title, normalizedSegment);
}

export function recordMediaHistory(userId: number, asset: Pick<MediaAsset, "id" | "kind" | "title">) {
  getDb()
    .prepare(
      `INSERT INTO user_media_history (user_id, media_id, kind, title, visit_count, last_accessed_at)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, media_id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         visit_count = user_media_history.visit_count + 1,
         last_accessed_at = CURRENT_TIMESTAMP`,
    )
    .run(userId, asset.id, asset.kind, asset.title);
}

export function listBrowseHistory(userId: number, options: { includeHidden?: boolean } = {}): BrowseHistoryItem[] {
  const visibleOnly = options.includeHidden === false ? 1 : 0;
  const rows = getDb()
    .prepare(
      `SELECT source, history_id, item_id, title, segment_index, visit_count, last_accessed_at, item_exists
       FROM (
         SELECT 'novel' AS source,
                h.id AS history_id,
                h.novel_id AS item_id,
                h.title,
                h.segment_index,
                h.visit_count,
                h.last_read_at AS last_accessed_at,
                CASE WHEN n.id IS NULL THEN 0 ELSE 1 END AS item_exists
         FROM user_reading_history h
         LEFT JOIN novels n ON n.id = h.novel_id
         WHERE h.user_id = ? AND (? = 0 OR h.hidden_by_user = 0)
         UNION ALL
         SELECT h.kind AS source,
                h.id AS history_id,
                h.media_id AS item_id,
                h.title,
                0 AS segment_index,
                h.visit_count,
                h.last_accessed_at,
                CASE WHEN m.id IS NULL THEN 0 ELSE 1 END AS item_exists
         FROM user_media_history h
         LEFT JOIN media_assets m ON m.id = h.media_id
         WHERE h.user_id = ? AND (? = 0 OR h.hidden_by_user = 0)
       )
       ORDER BY last_accessed_at DESC, history_id DESC
       LIMIT 200`,
    )
    .all(userId, visibleOnly, userId, visibleOnly) as Array<{
    source: "novel" | MediaKind;
    history_id: number;
    item_id: number;
    title: string;
    segment_index: number;
    visit_count: number;
    last_accessed_at: string;
    item_exists: number;
  }>;

  return rows.map((row) => ({
    key: `${row.source === "novel" ? "novel" : "media"}:${row.history_id}`,
    source: row.source,
    itemId: row.item_id,
    title: row.title,
    segmentIndex: row.segment_index,
    visitCount: row.visit_count,
    lastAccessedAt: row.last_accessed_at,
    itemExists: row.item_exists === 1,
  }));
}

export function listReadingHistory(userId: number): ReadingHistoryItem[] {
  const rows = getDb()
    .prepare(
      `SELECT h.id, h.novel_id, h.title, h.segment_index, h.visit_count, h.last_read_at, n.id AS existing_novel_id
       FROM user_reading_history h
       LEFT JOIN novels n ON n.id = h.novel_id
       WHERE h.user_id = ?
       ORDER BY h.last_read_at DESC, h.id DESC
       LIMIT 200`,
    )
    .all(userId) as Array<{
    id: number;
    novel_id: number;
    title: string;
    segment_index: number;
    visit_count: number;
    last_read_at: string;
    existing_novel_id: number | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    novelId: row.novel_id,
    title: row.title,
    segmentIndex: row.segment_index,
    visitCount: row.visit_count,
    lastReadAt: row.last_read_at,
    novelExists: row.existing_novel_id !== null,
  }));
}

export function listUserLoginRecords(userId: number, limit = 100): UserLoginRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT id, user_id, username, ip, user_agent, logged_at
       FROM user_login_records
       WHERE user_id = ?
       ORDER BY logged_at DESC, id DESC
       LIMIT ?`,
    )
    .all(userId, Math.min(Math.max(Math.floor(limit), 1), 200)) as Array<{
    id: number;
    user_id: number | null;
    username: string;
    ip: string;
    user_agent: string;
    logged_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    username: row.username,
    ip: row.ip,
    userAgent: row.user_agent,
    loggedAt: row.logged_at,
  }));
}

export function deleteReadingHistoryItem(userId: number, historyId: number): boolean {
  const info = getDb().prepare("DELETE FROM user_reading_history WHERE id = ? AND user_id = ?").run(historyId, userId);
  return Number(info.changes) > 0;
}

export function clearReadingHistory(userId: number): number {
  const info = getDb().prepare("DELETE FROM user_reading_history WHERE user_id = ?").run(userId);
  return Number(info.changes);
}

export function deleteBrowseHistoryItem(userId: number, key: string): boolean {
  const match = /^(novel|media):(\d+)$/.exec(key);
  if (!match) {
    return false;
  }
  const table = match[1] === "novel" ? "user_reading_history" : "user_media_history";
  const info = getDb().prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`).run(Number(match[2]), userId);
  return Number(info.changes) > 0;
}

export function hideBrowseHistoryItem(userId: number, key: string): boolean {
  const match = /^(novel|media):(\d+)$/.exec(key);
  if (!match) {
    return false;
  }
  const table = match[1] === "novel" ? "user_reading_history" : "user_media_history";
  const info = getDb().prepare(`UPDATE ${table} SET hidden_by_user = 1 WHERE id = ? AND user_id = ?`).run(Number(match[2]), userId);
  return Number(info.changes) > 0;
}

export function hideBrowseHistory(userId: number): number {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const novels = Number(db.prepare("UPDATE user_reading_history SET hidden_by_user = 1 WHERE user_id = ? AND hidden_by_user = 0").run(userId).changes);
    const media = Number(db.prepare("UPDATE user_media_history SET hidden_by_user = 1 WHERE user_id = ? AND hidden_by_user = 0").run(userId).changes);
    db.exec("COMMIT");
    return novels + media;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function clearBrowseHistory(userId: number): number {
  const db = getDb();
  db.exec("BEGIN");
  try {
    const novels = Number(db.prepare("DELETE FROM user_reading_history WHERE user_id = ?").run(userId).changes);
    const media = Number(db.prepare("DELETE FROM user_media_history WHERE user_id = ?").run(userId).changes);
    db.exec("COMMIT");
    return novels + media;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
