import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { readRuntimeSiteSettings } from "@/core/config/runtime-site-settings";
import { queuePostgresTelegramText } from "@/domains/notifications/postgres-telegram-outbox";
import { getTelegramConfig } from "@/lib/telegram-config";
import { STATION_MESSAGE_MAX_LENGTH, stationMessageLength } from "@/lib/station-protocol";

export type AnnouncementAudience = "public" | "member";
export type AnnouncementImportance = "normal" | "important";
export type AnnouncementStatus = "draft" | "published" | "archived";
export type AnnouncementDisplayMode = "list" | "drawer" | "both";

export type Announcement = Readonly<{
  id: number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  importance: AnnouncementImportance;
  displayMode: AnnouncementDisplayMode;
  entryVersion: string;
  status: AnnouncementStatus;
  publishedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type StationThread = Readonly<{
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
}>;

export type StationMessage = Readonly<{
  id: number;
  threadId: number;
  authorRole: "user" | "admin";
  body: string;
  createdAt: string;
}>;

export type StationMessageListOptions = { afterId?: number };
type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

export class StationInputError extends Error {}

type AnnouncementRow = QueryResultRow & {
  id: string | number;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  importance: AnnouncementImportance;
  display_mode: AnnouncementDisplayMode;
  entry_version: string;
  status: AnnouncementStatus;
  published_at: Date | string | null;
  expires_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type StationThreadRow = QueryResultRow & {
  id: string | number;
  user_id: string | number;
  username: string;
  display_name: string;
  subject: string;
  status: "open" | "closed";
  user_last_read_message_id: string | number;
  admin_last_read_message_id: string | number;
  latest_admin_message_id: string | number | null;
  latest_user_message_id: string | number | null;
  last_message_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
};

type StationMessageRow = QueryResultRow & {
  id: string | number;
  thread_id: string | number;
  author_role: "user" | "admin";
  body: string;
  created_at: Date | string;
};

function integer(value: string | number, label: string, allowZero = false): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) throw new Error("Invalid PostgreSQL " + label);
  return parsed;
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL " + label);
  return parsed.toISOString();
}

function cleanTitle(value: unknown, label = "标题"): string {
  const title = Array.from(String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim()).slice(0, 80).join("");
  if (!title) throw new StationInputError(label + "不能为空");
  return title;
}

function cleanBody(value: unknown): string {
  const body = Array.from(String(value || "").trim()).slice(0, 4_000).join("");
  if (!body) throw new StationInputError("内容不能为空");
  return body;
}

function cleanStationMessageBody(value: unknown): string {
  const body = String(value || "").trim();
  if (!body) throw new StationInputError("内容不能为空");
  if (stationMessageLength(body) > STATION_MESSAGE_MAX_LENGTH) {
    throw new StationInputError(`消息不能超过 ${STATION_MESSAGE_MAX_LENGTH} 字`);
  }
  return body;
}

function createEntryVersion(): string {
  return crypto.randomBytes(12).toString("base64url");
}

function cleanDisplayMode(value: unknown): AnnouncementDisplayMode {
  return value === "drawer" || value === "both" ? value : "list";
}

function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: integer(row.id, "announcement id"),
    title: row.title,
    body: row.body,
    audience: row.audience,
    importance: row.importance,
    displayMode: row.display_mode,
    entryVersion: row.entry_version,
    status: row.status,
    publishedAt: timestamp(row.published_at, "announcement publish time"),
    expiresAt: timestamp(row.expires_at, "announcement expiry time"),
    createdAt: timestamp(row.created_at, "announcement creation time") ?? "",
    updatedAt: timestamp(row.updated_at, "announcement update time") ?? "",
  };
}

function toStationThread(row: StationThreadRow): StationThread {
  const latestAdmin = row.latest_admin_message_id == null ? 0 : integer(row.latest_admin_message_id, "latest admin message id");
  const latestUser = row.latest_user_message_id == null ? 0 : integer(row.latest_user_message_id, "latest user message id");
  return {
    id: integer(row.id, "station thread id"),
    userId: integer(row.user_id, "station user id"),
    username: row.username,
    displayName: row.display_name,
    subject: row.subject,
    status: row.status,
    unreadForUser: latestAdmin > integer(row.user_last_read_message_id, "user read marker", true),
    unreadForAdmin: latestUser > integer(row.admin_last_read_message_id, "admin read marker", true),
    lastMessageAt: timestamp(row.last_message_at, "station last-message time") ?? "",
    createdAt: timestamp(row.created_at, "station creation time") ?? "",
    updatedAt: timestamp(row.updated_at, "station update time") ?? "",
  };
}

function toStationMessage(row: StationMessageRow): StationMessage {
  return {
    id: integer(row.id, "station message id"),
    threadId: integer(row.thread_id, "station thread id"),
    authorRole: row.author_role,
    body: row.body,
    createdAt: timestamp(row.created_at, "station message time") ?? "",
  };
}

const ANNOUNCEMENT_SELECT = `SELECT id, title, body, audience, importance, display_mode,
  entry_version, status, published_at, expires_at, created_at, updated_at FROM announcements`;

const THREAD_SELECT = `SELECT thread.id, thread.user_id, account.username, account.display_name,
  thread.subject, thread.status, thread.user_last_read_message_id, thread.admin_last_read_message_id,
  latest.latest_admin_message_id, latest.latest_user_message_id,
  thread.last_message_at, thread.created_at, thread.updated_at
  FROM station_threads thread
  INNER JOIN users account ON account.id = thread.user_id
  LEFT JOIN LATERAL (
    SELECT MAX(message.id) FILTER (WHERE message.author_role = 'admin') AS latest_admin_message_id,
      MAX(message.id) FILTER (WHERE message.author_role = 'user') AS latest_user_message_id
    FROM station_messages message WHERE message.thread_id = thread.id
  ) latest ON TRUE`;

function visibleAnnouncementWhere(authenticated: boolean, displayMode: "list" | "drawer" = "list"): string {
  const modeClause = displayMode === "drawer"
    ? "display_mode IN ('drawer', 'both')"
    : "display_mode IN ('list', 'both')";
  return `status = 'published' AND ${modeClause}
    AND published_at IS NOT NULL AND published_at <= clock_timestamp()
    AND (expires_at IS NULL OR expires_at > clock_timestamp())
    ${authenticated ? "" : "AND audience = 'public'"}`;
}

const LEGACY_ENTRY_NOTICE_MIGRATION_KEY = "announcements.entry-drawer-legacy-v2";
let legacyNoticeMigration: Promise<void> | undefined;

export function migrateLegacyPostgresEntryNotice(): Promise<void> {
  if (process.env.NEXT_PHASE === "phase-production-build") return Promise.resolve();
  if (legacyNoticeMigration) return legacyNoticeMigration;
  legacyNoticeMigration = withTransaction(async (tx) => {
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      values: [LEGACY_ENTRY_NOTICE_MIGRATION_KEY],
    });
    const existing = await tx.query({
      text: "SELECT 1 FROM app_metadata WHERE key = $1",
      values: [LEGACY_ENTRY_NOTICE_MIGRATION_KEY],
    });
    if (existing.rowCount) return;
    const settings = readRuntimeSiteSettings();
    if (settings.siteEntryNoticeEnabled && settings.siteEntryNoticeMarkdown.trim()) {
      await tx.query({
        text: `INSERT INTO announcements
          (title, body, audience, importance, display_mode, entry_version, status, published_at)
          SELECT $1, $2, 'public', 'important', 'drawer', $3, 'published', clock_timestamp()
          WHERE NOT EXISTS (
            SELECT 1 FROM announcements
            WHERE display_mode IN ('drawer', 'both') AND title = $1 AND body = $2
          )`,
        values: [
          settings.siteEntryNoticeTitle,
          settings.siteEntryNoticeMarkdown,
          settings.siteEntryNoticeVersion || createEntryVersion(),
        ],
      });
    }
    await tx.query({
      text: `INSERT INTO app_metadata (key, value) VALUES ($1, '1')
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = clock_timestamp()`,
      values: [LEGACY_ENTRY_NOTICE_MIGRATION_KEY],
    });
  }, { role: "jobs" }).catch((error: unknown) => {
    legacyNoticeMigration = undefined;
    throw error;
  });
  return legacyNoticeMigration;
}

async function getFirstAnnouncement(executor: SqlExecutor, where: string, values: readonly unknown[] = []): Promise<Announcement | null> {
  const result = await executor.query<AnnouncementRow>({
    text: `${ANNOUNCEMENT_SELECT} WHERE ${where}
      ORDER BY CASE importance WHEN 'important' THEN 0 ELSE 1 END, published_at DESC, id DESC
      LIMIT 1`,
    values,
  });
  return result.rows[0] ? toAnnouncement(result.rows[0]) : null;
}

export function getPostgresHomeAnnouncement(executor: SqlExecutor, authenticated: boolean): Promise<Announcement | null> {
  return getFirstAnnouncement(executor, visibleAnnouncementWhere(authenticated, "list"));
}

export async function listPostgresVisibleAnnouncements(
  executor: SqlExecutor,
  authenticated: boolean,
  limitValue = 50,
): Promise<Announcement[]> {
  const limit = Math.min(Math.max(Math.floor(limitValue), 1), 200);
  const result = await executor.query<AnnouncementRow>({
    text: `${ANNOUNCEMENT_SELECT} WHERE ${visibleAnnouncementWhere(authenticated, "list")}
      ORDER BY CASE importance WHEN 'important' THEN 0 ELSE 1 END, published_at DESC, id DESC
      LIMIT $1`,
    values: [limit],
  });
  return result.rows.map(toAnnouncement);
}

export function getPostgresEntryDrawerAnnouncement(executor: SqlExecutor, authenticated: boolean): Promise<Announcement | null> {
  return getFirstAnnouncement(executor, visibleAnnouncementWhere(authenticated, "drawer"));
}

export function getPostgresVisibleAnnouncement(
  executor: SqlExecutor,
  idValue: number,
  options: { authenticated?: boolean; admin?: boolean } = {},
): Promise<Announcement | null> {
  const id = integer(idValue, "announcement id");
  const where = options.admin
    ? "id = $1"
    : `id = $1 AND ${visibleAnnouncementWhere(Boolean(options.authenticated))}`;
  return getFirstAnnouncement(executor, where, [id]);
}

export async function listPostgresAdminAnnouncements(executor: SqlExecutor, limitValue = 100): Promise<Announcement[]> {
  const limit = Math.min(Math.max(Math.floor(limitValue), 1), 300);
  const result = await executor.query<AnnouncementRow>({
    text: `${ANNOUNCEMENT_SELECT}
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, updated_at DESC, id DESC
      LIMIT $1`,
    values: [limit],
  });
  return result.rows.map(toAnnouncement);
}

function optionalDate(value: string | null | undefined, label: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new StationInputError(label + "无效");
  return parsed;
}

async function queueAnnouncementNotification(executor: SqlExecutor, announcement: Announcement): Promise<void> {
  const chatId = getTelegramConfig()?.announcementChatId;
  if (!chatId) return;
  const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  await queuePostgresTelegramText(executor, chatId, [
    `<b>${escape(announcement.title)}</b>`,
    "",
    escape(announcement.body).slice(0, 3_500),
  ].join("\n"), {
    dedupeKey: `announcement:${announcement.id}:${announcement.entryVersion || announcement.updatedAt}`,
  });
}

export async function savePostgresAnnouncement(
  input: {
    id?: number;
    title: unknown;
    body: unknown;
    audience?: unknown;
    importance?: unknown;
    displayMode?: unknown;
    status?: unknown;
    publishedAt?: string | null;
    expiresAt?: string | null;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<Announcement> {
  const id = Math.floor(Number(input.id || 0));
  const title = cleanTitle(input.title);
  const body = cleanBody(input.body);
  const audience: AnnouncementAudience = input.audience === "member" ? "member" : "public";
  const importance: AnnouncementImportance = input.importance === "important" ? "important" : "normal";
  const displayMode = cleanDisplayMode(input.displayMode);
  const status: AnnouncementStatus = input.status === "published" || input.status === "archived" ? input.status : "draft";
  const publishedAt = status === "published"
    ? optionalDate(input.publishedAt, "发布时间") ?? new Date()
    : optionalDate(input.publishedAt, "发布时间");
  const expiresAt = optionalDate(input.expiresAt, "过期时间");
  if (expiresAt && publishedAt && expiresAt <= publishedAt) throw new StationInputError("过期时间必须晚于发布时间");

  return transaction(async (tx) => {
    let saved: AnnouncementRow | undefined;
    if (Number.isSafeInteger(id) && id > 0) {
      const previousResult = await tx.query<AnnouncementRow>({
        text: `${ANNOUNCEMENT_SELECT} WHERE id = $1 FOR UPDATE`,
        values: [id],
      });
      if (!previousResult.rows[0]) throw new StationInputError("公告不存在");
      const previous = toAnnouncement(previousResult.rows[0]);
      const publishedIso = publishedAt?.toISOString() ?? null;
      const expiresIso = expiresAt?.toISOString() ?? null;
      const changed = previous.title !== title || previous.body !== body || previous.audience !== audience ||
        previous.importance !== importance || previous.displayMode !== displayMode || previous.status !== status ||
        previous.publishedAt !== publishedIso || previous.expiresAt !== expiresIso;
      const entryVersion = displayMode === "list" ? "" : changed ? createEntryVersion() : previous.entryVersion || createEntryVersion();
      const result = await tx.query<AnnouncementRow>({
        text: `UPDATE announcements SET title = $2, body = $3, audience = $4, importance = $5,
          display_mode = $6, entry_version = $7, status = $8, published_at = $9,
          expires_at = $10, updated_at = clock_timestamp()
          WHERE id = $1
          RETURNING id, title, body, audience, importance, display_mode, entry_version,
            status, published_at, expires_at, created_at, updated_at`,
        values: [id, title, body, audience, importance, displayMode, entryVersion, status, publishedAt, expiresAt],
      });
      saved = result.rows[0];
    } else {
      const result = await tx.query<AnnouncementRow>({
        text: `INSERT INTO announcements
          (title, body, audience, importance, display_mode, entry_version, status, published_at, expires_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, title, body, audience, importance, display_mode, entry_version,
            status, published_at, expires_at, created_at, updated_at`,
        values: [title, body, audience, importance, displayMode, displayMode === "list" ? "" : createEntryVersion(), status, publishedAt, expiresAt],
      });
      saved = result.rows[0];
    }
    if (!saved) throw new StationInputError("公告保存失败");
    const announcement = toAnnouncement(saved);
    if (announcement.status === "published") await queueAnnouncementNotification(tx, announcement);
    return announcement;
  });
}

export async function deletePostgresAnnouncement(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM announcements WHERE id = $1",
    values: [integer(idValue, "announcement id")],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function markPostgresAnnouncementRead(
  executor: SqlExecutor,
  userIdValue: number,
  announcementIdValue: number,
): Promise<void> {
  await executor.query({
    text: `INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1, $2)
      ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = clock_timestamp()`,
    values: [integer(announcementIdValue, "announcement id"), integer(userIdValue, "station user id")],
  });
}

export async function listPostgresUserStationThreads(executor: SqlExecutor, userIdValue: number): Promise<StationThread[]> {
  const result = await executor.query<StationThreadRow>({
    text: `${THREAD_SELECT}
      WHERE thread.user_id = $1
      ORDER BY thread.last_message_at DESC, thread.id DESC LIMIT 100`,
    values: [integer(userIdValue, "station user id")],
  });
  return result.rows.map(toStationThread);
}

export async function listPostgresAdminStationThreads(executor: SqlExecutor, limitValue = 200): Promise<StationThread[]> {
  const limit = Math.min(Math.max(Math.floor(limitValue), 1), 500);
  const result = await executor.query<StationThreadRow>({
    text: `${THREAD_SELECT}
      ORDER BY CASE WHEN COALESCE(latest.latest_user_message_id, 0) > thread.admin_last_read_message_id THEN 0 ELSE 1 END,
        CASE thread.status WHEN 'open' THEN 0 ELSE 1 END,
        thread.last_message_at DESC, thread.id DESC
      LIMIT $1`,
    values: [limit],
  });
  return result.rows.map(toStationThread);
}

export async function getPostgresStationThread(
  executor: SqlExecutor,
  idValue: number,
  options: { userId?: number; admin?: boolean } = {},
): Promise<StationThread | null> {
  const id = integer(idValue, "station thread id");
  const result = await executor.query<StationThreadRow>({
    text: `${THREAD_SELECT} WHERE ${options.admin ? "thread.id = $1" : "thread.id = $1 AND thread.user_id = $2"}`,
    values: options.admin ? [id] : [id, integer(options.userId ?? 0, "station user id")],
  });
  return result.rows[0] ? toStationThread(result.rows[0]) : null;
}

export async function listPostgresStationMessages(
  executor: SqlExecutor,
  threadIdValue: number,
  options: StationMessageListOptions = {},
): Promise<StationMessage[]> {
  const threadId = integer(threadIdValue, "station thread id");
  const afterId = Math.max(Math.floor(Number(options.afterId || 0)) || 0, 0);
  const result = await executor.query<StationMessageRow>({
    text: `SELECT id, thread_id, author_role, body, created_at FROM station_messages
      WHERE thread_id = $1 ${afterId > 0 ? "AND id > $2" : ""}
      ORDER BY id ASC`,
    values: afterId > 0 ? [threadId, afterId] : [threadId],
  });
  return result.rows.map(toStationMessage);
}

type StationNotificationRow = QueryResultRow & {
  subject: string;
  user_id: string | number;
  username: string;
  display_name: string;
  body: string;
  chat_id: string | null;
};

async function queueStationNotification(
  executor: SqlExecutor,
  threadId: number,
  messageId: number,
  authorRole: "user" | "admin",
): Promise<void> {
  const config = getTelegramConfig();
  if (!config) return;
  const result = await executor.query<StationNotificationRow>({
    text: `SELECT thread.subject, thread.user_id, account.username, account.display_name,
      message.body, telegram.chat_id
      FROM station_threads thread
      INNER JOIN users account ON account.id = thread.user_id
      INNER JOIN station_messages message ON message.thread_id = thread.id AND message.id = $2
      LEFT JOIN telegram_user_links telegram ON telegram.user_id = thread.user_id
      WHERE thread.id = $1`,
    values: [threadId, messageId],
  });
  const row = result.rows[0];
  if (!row) return;
  const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
  const metadata = { stationThreadId: threadId, stationMessageId: messageId };
  if (authorRole === "user") {
    const text = [
      `<b>站务消息</b> · ${escape(row.subject)}`,
      `${escape(row.display_name)} (@${escape(row.username)})`,
      "",
      escape(row.body),
      "",
      "直接回复此消息即可回信。",
    ].join("\n");
    for (const chatId of config.adminChatIds) {
      await queuePostgresTelegramText(executor, chatId, text, {
        dedupeKey: `station-admin:${messageId}:${chatId}`,
        metadata,
      });
    }
  } else if (row.chat_id) {
    await queuePostgresTelegramText(executor, row.chat_id, [
      `<b>站务回复</b> · ${escape(row.subject)}`,
      "",
      escape(row.body),
      "",
      "直接回复此消息可继续对话。",
    ].join("\n"), {
      dedupeKey: `station-user:${messageId}:${row.chat_id}`,
      metadata,
    });
  }
}

async function createStationThread(
  userIdValue: number,
  subjectValue: unknown,
  bodyValue: unknown,
  authorRole: "user" | "admin",
  transaction: TransactionRunner,
): Promise<number> {
  const userId = integer(userIdValue, "station user id");
  const subject = cleanTitle(subjectValue, "主题");
  const body = cleanStationMessageBody(bodyValue);
  return transaction(async (tx) => {
    const eligible = await tx.query({
      text: "SELECT 1 FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL",
      values: [userId],
    });
    if (!eligible.rowCount) throw new StationInputError(authorRole === "admin" ? "用户不存在或不可用" : "账户不可用");
    const threadResult = await tx.query<QueryResultRow & { id: string | number }>({
      text: "INSERT INTO station_threads (user_id, subject) VALUES ($1, $2) RETURNING id",
      values: [userId, subject],
    });
    const threadId = integer(threadResult.rows[0]?.id ?? 0, "inserted station thread id");
    const messageResult = await tx.query<QueryResultRow & { id: string | number }>({
      text: `INSERT INTO station_messages (thread_id, author_role, author_user_id, body)
        VALUES ($1, $2, $3, $4) RETURNING id`,
      values: [threadId, authorRole, authorRole === "user" ? userId : null, body],
    });
    const messageId = integer(messageResult.rows[0]?.id ?? 0, "inserted station message id");
    await tx.query({
      text: `UPDATE station_threads SET
        user_last_read_message_id = $2,
        admin_last_read_message_id = $3,
        last_message_at = clock_timestamp(), updated_at = clock_timestamp()
        WHERE id = $1`,
      values: [threadId, authorRole === "user" ? messageId : 0, authorRole === "admin" ? messageId : 0],
    });
    await queueStationNotification(tx, threadId, messageId, authorRole);
    return threadId;
  });
}

export function createPostgresStationThread(
  userId: number,
  subject: unknown,
  body: unknown,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  return createStationThread(userId, subject, body, "user", transaction);
}

export function createPostgresAdminStationThread(
  userId: number,
  subject: unknown,
  body: unknown,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  return createStationThread(userId, subject, body, "admin", transaction);
}

export async function findPostgresStationRecipientId(executor: SqlExecutor, usernameValue: unknown): Promise<number | null> {
  const username = String(usernameValue || "").normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/u.test(username)) return null;
  const result = await executor.query<QueryResultRow & { id: string | number }>({
    text: "SELECT id FROM users WHERE username = $1 AND status = 'active' AND deleted_at IS NULL",
    values: [username],
  });
  return result.rows[0] ? integer(result.rows[0].id, "station recipient id") : null;
}

export async function addPostgresStationReply(
  input: { threadId: number; body: unknown; authorRole: "user" | "admin"; userId?: number },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<boolean> {
  const threadId = integer(input.threadId, "station thread id");
  const body = cleanStationMessageBody(input.body);
  const userId = input.authorRole === "user" ? integer(input.userId ?? 0, "station user id") : null;
  return transaction(async (tx) => {
    const thread = await tx.query({
      text: `SELECT 1 FROM station_threads
        WHERE id = $1 AND status = 'open' ${input.authorRole === "user" ? "AND user_id = $2" : ""}
        FOR UPDATE`,
      values: input.authorRole === "user" ? [threadId, userId] : [threadId],
    });
    if (!thread.rowCount) return false;
    const inserted = await tx.query<QueryResultRow & { id: string | number }>({
      text: `INSERT INTO station_messages (thread_id, author_role, author_user_id, body)
        VALUES ($1, $2, $3, $4) RETURNING id`,
      values: [threadId, input.authorRole, userId, body],
    });
    const messageId = integer(inserted.rows[0]?.id ?? 0, "inserted station message id");
    const readColumn = input.authorRole === "user" ? "user_last_read_message_id" : "admin_last_read_message_id";
    await tx.query({
      text: `UPDATE station_threads SET ${readColumn} = $2,
        last_message_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`,
      values: [threadId, messageId],
    });
    await queueStationNotification(tx, threadId, messageId, input.authorRole);
    return true;
  });
}

export async function deletePostgresStationThread(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM station_threads WHERE id = $1",
    values: [integer(idValue, "station thread id")],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function setPostgresStationThreadStatus(
  executor: SqlExecutor,
  idValue: number,
  status: "open" | "closed",
): Promise<boolean> {
  const result = await executor.query({
    text: `UPDATE station_threads SET status = $2, updated_at = clock_timestamp() WHERE id = $1`,
    values: [integer(idValue, "station thread id"), status],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function markPostgresStationThreadRead(
  executor: SqlExecutor,
  threadIdValue: number,
  reader: "user" | "admin",
  userIdValue?: number,
): Promise<boolean> {
  const threadId = integer(threadIdValue, "station thread id");
  const userId = reader === "user" ? integer(userIdValue ?? 0, "station user id") : null;
  const column = reader === "admin" ? "admin_last_read_message_id" : "user_last_read_message_id";
  const result = await executor.query({
    text: `UPDATE station_threads thread SET ${column} = COALESCE((
        SELECT MAX(message.id) FROM station_messages message WHERE message.thread_id = thread.id
      ), ${column})
      WHERE thread.id = $1 ${reader === "user" ? "AND thread.user_id = $2" : ""}`,
    values: reader === "user" ? [threadId, userId] : [threadId],
  });
  return (result.rowCount ?? 0) > 0;
}

export function markAllPostgresUserMessagesRead(
  userIdValue: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<void> {
  const userId = integer(userIdValue, "station user id");
  return transaction(async (tx) => {
    await tx.query({
      text: `INSERT INTO announcement_reads (announcement_id, user_id)
        SELECT announcement.id, $1 FROM announcements announcement
        WHERE ${visibleAnnouncementWhere(true)}
        ON CONFLICT (announcement_id, user_id) DO UPDATE SET read_at = clock_timestamp()`,
      values: [userId],
    });
    await tx.query({
      text: `UPDATE station_threads thread
        SET user_last_read_message_id = COALESCE((
          SELECT MAX(message.id) FROM station_messages message WHERE message.thread_id = thread.id
        ), user_last_read_message_id)
        WHERE thread.user_id = $1`,
      values: [userId],
    });
  });
}

export async function countPostgresUserUnreadMessages(executor: SqlExecutor, userIdValue: number): Promise<number> {
  const userId = integer(userIdValue, "station user id");
  const result = await executor.query<QueryResultRow & { unread_count: string | number }>({
    name: "station-count-user-unread-v1",
    text: `SELECT (
        SELECT COUNT(*) FROM announcements announcement
        WHERE ${visibleAnnouncementWhere(true)}
          AND NOT EXISTS (
            SELECT 1 FROM announcement_reads read
            WHERE read.announcement_id = announcement.id AND read.user_id = $1
          )
      ) + (
        SELECT COUNT(*) FROM station_threads thread
        WHERE thread.user_id = $1 AND EXISTS (
          SELECT 1 FROM station_messages message
          WHERE message.thread_id = thread.id AND message.author_role = 'admin'
            AND message.id > thread.user_last_read_message_id
        )
      ) AS unread_count`,
    values: [userId],
  });
  return integer(result.rows[0]?.unread_count ?? 0, "user unread count", true);
}

export async function countPostgresAdminUnreadMessages(executor: SqlExecutor = database("web")): Promise<number> {
  const result = await executor.query<QueryResultRow & { unread_count: string | number }>({
    name: "station-count-admin-unread-v1",
    text: `SELECT COUNT(*) AS unread_count FROM station_threads thread
      WHERE EXISTS (
        SELECT 1 FROM station_messages message
        WHERE message.thread_id = thread.id AND message.author_role = 'user'
          AND message.id > thread.admin_last_read_message_id
      )`,
  });
  return integer(result.rows[0]?.unread_count ?? 0, "admin unread count", true);
}
