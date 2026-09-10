import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { removeUserAvatarFile } from "./avatar-storage";
import { normalizeUsername } from "./account-input";

export type PostgresUserStatus = "active" | "disabled" | "pending";
export type PostgresUserRole = "user" | "admin";
export type PostgresUserProfile = Readonly<{
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  emailVerifiedAt: string | null;
  avatarPath: string | null;
  status: PostgresUserStatus;
  role: PostgresUserRole;
  trustLevel: number;
  sodaBalance: number;
  sodaExperience: number;
  cookieBalance: number;
  localePreference: "zh-Hans" | "zh-Hant";
  readingHistoryEnabled: boolean;
  originalReadingHistoryEnabled: boolean;
  registrationIp: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
}>;
export type PostgresUserListResult = Readonly<{
  users: PostgresUserProfile[];
  page: number;
  pageSize: number;
  totalUsers: number;
  totalPages: number;
  query: string;
}>;
export type PostgresBrowseHistoryItem = Readonly<{
  key: string;
  source: "novel" | "video" | "audio" | "file";
  itemId: number;
  title: string;
  segmentIndex: number;
  visitCount: number;
  lastAccessedAt: string;
  itemExists: boolean;
}>;
export type PostgresUserLoginRecord = Readonly<{
  id: number;
  userId: number | null;
  username: string;
  ip: string;
  userAgent: string;
  loggedAt: string;
}>;
export type PostgresPage<T> = Readonly<{ items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number }>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type UserRow = QueryResultRow & {
  id: string | number;
  username: string;
  display_name: string;
  email: string | null;
  email_verified_at: Date | string | null;
  avatar_path: string | null;
  status: string;
  role: string;
  trust_level: string | number;
  soda_balance: string | number;
  soda_experience: string | number;
  cookie_balance: string | number;
  locale_preference: string;
  reading_history_enabled: boolean;
  original_reading_history_enabled: boolean;
  registration_ip: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
  last_login_ip: string | null;
};
type ListedUserRow = UserRow & { total_users: string | number; total_pages: string | number; page: string | number };
type PagedRow = QueryResultRow & { total_items: string | number; total_pages: string | number; page: string | number };

const USER_COLUMNS = `id, username, display_name, email, email_verified_at, avatar_path, status, role,
  trust_level, soda_balance, soda_experience, cookie_balance, locale_preference,
  reading_history_enabled, original_reading_history_enabled, registration_ip,
  created_at, updated_at, last_login_at, last_login_ip`;

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function integer(value: string | number | null | undefined, label: string, minimum = 0): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return date.toISOString();
}

function userStatus(value: string): PostgresUserStatus {
  if (value !== "active" && value !== "disabled" && value !== "pending") throw new Error("Invalid PostgreSQL user status");
  return value;
}

function userRole(value: string): PostgresUserRole {
  if (value !== "user" && value !== "admin") throw new Error("Invalid PostgreSQL user role");
  return value;
}

function userProfile(row: UserRow): PostgresUserProfile {
  if (row.locale_preference !== "zh-Hans" && row.locale_preference !== "zh-Hant") throw new Error("Invalid PostgreSQL user locale");
  return {
    id: positiveId(Number(row.id), "user id"), username: row.username, displayName: row.display_name,
    email: row.email, emailVerifiedAt: timestamp(row.email_verified_at, "email verification timestamp"),
    avatarPath: row.avatar_path, status: userStatus(row.status), role: userRole(row.role),
    trustLevel: integer(row.trust_level, "trust level"), sodaBalance: integer(row.soda_balance, "soda balance"),
    sodaExperience: integer(row.soda_experience, "soda experience"), cookieBalance: integer(row.cookie_balance, "cookie balance"),
    localePreference: row.locale_preference, readingHistoryEnabled: row.reading_history_enabled === true,
    originalReadingHistoryEnabled: row.original_reading_history_enabled === true,
    registrationIp: row.registration_ip, createdAt: timestamp(row.created_at, "created timestamp")!,
    updatedAt: timestamp(row.updated_at, "updated timestamp")!, lastLoginAt: timestamp(row.last_login_at, "last login timestamp"),
    lastLoginIp: row.last_login_ip,
  };
}

function boundedPageSize(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value ?? fallback), 1), 200) : fallback;
}

export async function getPostgresUserById(executor: SqlExecutor, userIdValue: number): Promise<PostgresUserProfile | null> {
  const result = await executor.query<UserRow>({
    name: "identity-admin-user-by-id-v1",
    text: `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    values: [positiveId(userIdValue, "user id")],
  });
  return result.rows[0] ? userProfile(result.rows[0]) : null;
}

export async function listPostgresUsers(
  executor: SqlExecutor,
  input: { page?: number; q?: string; pageSize?: number },
): Promise<PostgresUserListResult> {
  const pageSize = boundedPageSize(input.pageSize, 30);
  const requestedPage = Number.isFinite(input.page) ? Math.max(Math.floor(input.page ?? 1), 1) : 1;
  const query = Array.from((input.q ?? "").normalize("NFKC").trim()).slice(0, 120).join("");
  const result = await executor.query<ListedUserRow>({
    text: `WITH filtered AS MATERIALIZED (
        SELECT * FROM users WHERE $1 = '' OR username ILIKE '%' || $1 || '%' OR display_name ILIKE '%' || $1 || '%'
          OR COALESCE(email, '') ILIKE '%' || $1 || '%' OR COALESCE(last_login_ip, '') ILIKE '%' || $1 || '%'
          OR COALESCE(registration_ip, '') ILIKE '%' || $1 || '%'
      ), page_info AS (
        SELECT COUNT(*)::bigint AS total_users, GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages FROM filtered
      ), requested AS (
        SELECT total_users, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.total_users, requested.total_pages, requested.page, item.*
      FROM requested LEFT JOIN LATERAL (
        SELECT ${USER_COLUMNS} FROM filtered ORDER BY updated_at DESC, id DESC
        LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [query, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL user page metadata is missing");
  return {
    users: result.rows.flatMap((row) => row.id == null ? [] : [userProfile(row)]),
    page: integer(first.page, "user page", 1), pageSize,
    totalUsers: integer(first.total_users, "user total"), totalPages: integer(first.total_pages, "user total pages", 1), query,
  };
}

export async function createPostgresManagedUser(executor: SqlExecutor, input: {
  username: string; displayName: string; passwordHash: string; status: PostgresUserStatus; role: PostgresUserRole;
  sodaBalance: number; sodaExperience: number; cookieBalance: number;
}): Promise<number> {
  const sodaBalance = Math.max(Math.floor(input.sodaBalance), 0);
  const sodaExperience = Math.max(Math.floor(input.sodaExperience), sodaBalance);
  const cookieBalance = Math.max(Math.floor(input.cookieBalance), 0);
  const result = await executor.query<QueryResultRow & { id: string | number }>({
    text: `INSERT INTO users
      (username, display_name, password_hash, status, role, trust_level, soda_balance, soda_experience, cookie_balance, updated_at)
      VALUES ($1, $2, $3, $4, $5,
        COALESCE((SELECT MAX(level) FROM user_levels WHERE soda_required <= $7), 1), $6, $7, $8, clock_timestamp())
      RETURNING id`,
    values: [normalizeUsername(input.username), input.displayName.trim(), input.passwordHash, input.status, input.role,
      sodaBalance, sodaExperience, cookieBalance],
  });
  return positiveId(Number(result.rows[0]?.id), "created user id");
}

export async function updatePostgresManagedUser(executor: SqlExecutor, input: {
  id: number; displayName: string; status: PostgresUserStatus; role: PostgresUserRole; passwordHash?: string;
}): Promise<boolean> {
  const result = await executor.query({
    text: `UPDATE users SET display_name = $2, status = $3, role = $4,
      password_hash = COALESCE($5::text, password_hash), updated_at = clock_timestamp()
      WHERE id = $1 AND deleted_at IS NULL`,
    values: [positiveId(input.id, "user id"), input.displayName.trim(), input.status, input.role, input.passwordHash ?? null],
  });
  return result.rowCount === 1;
}

export async function updatePostgresUserStatus(executor: SqlExecutor, userIdValue: number, status: PostgresUserStatus): Promise<boolean> {
  const result = await executor.query({
    text: "UPDATE users SET status = $2, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL",
    values: [positiveId(userIdValue, "user id"), status],
  });
  return result.rowCount === 1;
}

export async function anonymizePostgresUsers(
  idsValue: readonly number[],
  actorValue = "admin",
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  const ids = [...new Set(idsValue.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, 500);
  if (!ids.length) return 0;
  const actor = Array.from(actorValue.trim()).slice(0, 120).join("") || "admin";
  const rows = await transaction(async (tx) => {
    const selected = await tx.query<QueryResultRow & { id: string | number; username: string; avatar_path: string | null }>({
      text: "SELECT id, username, avatar_path FROM users WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id FOR UPDATE",
      values: [ids],
    });
    for (const row of selected.rows) {
      const id = positiveId(Number(row.id), "anonymized user id");
      const anonymousUsername = `deleted-${id}-${crypto.randomBytes(6).toString("hex")}`;
      await tx.query({ text: "DELETE FROM user_sessions WHERE user_id = $1", values: [id] });
      await tx.query({ text: "DELETE FROM email_verification_tokens WHERE user_id = $1", values: [id] });
      await tx.query({ text: "DELETE FROM telegram_user_links WHERE user_id = $1", values: [id] });
      await tx.query({
        text: `UPDATE users SET username = $2, display_name = '已注销用户', email = NULL, email_verified_at = NULL,
          password_hash = $3, avatar_path = NULL, status = 'disabled', role = 'user', registration_ip = NULL,
          last_login_ip = NULL, last_login_at = NULL, deleted_at = clock_timestamp(), updated_at = clock_timestamp()
          WHERE id = $1`,
        values: [id, anonymousUsername, `disabled:${anonymousUsername}`],
      });
      await tx.query({
        text: "INSERT INTO admin_user_anonymization_audit (user_id, previous_username, actor) VALUES ($1, $2, $3)",
        values: [id, row.username, actor],
      });
    }
    return selected.rows.map((row) => row.avatar_path);
  });
  for (const avatarPath of rows) removeUserAvatarFile(avatarPath);
  return rows.length;
}

export async function listPostgresBrowseHistoryPage(
  executor: SqlExecutor, userIdValue: number, input: { page?: number; pageSize?: number } = {},
): Promise<PostgresPage<PostgresBrowseHistoryItem>> {
  const userId = positiveId(userIdValue, "user id");
  const pageSize = boundedPageSize(input.pageSize, 20);
  const requestedPage = Number.isFinite(input.page) ? Math.max(Math.floor(input.page ?? 1), 1) : 1;
  const result = await executor.query<PagedRow & {
    source: string | null; history_id: string | number | null; item_id: string | number | null; title: string | null;
    segment_index: number | null; visit_count: string | number | null; last_accessed_at: Date | string | null; item_exists: boolean | null;
  }>({
    text: `WITH history AS MATERIALIZED (
        SELECT 'novel'::text AS source, reading.id AS history_id, reading.novel_id AS item_id, reading.title,
               reading.segment_index, reading.visit_count, reading.last_read_at AS last_accessed_at, novel.id IS NOT NULL AS item_exists
        FROM user_reading_history reading LEFT JOIN novels novel ON novel.id = reading.novel_id WHERE reading.user_id = $1
        UNION ALL
        SELECT media_history.kind, media_history.id, media_history.media_id, media_history.title, 0,
               media_history.visit_count, media_history.last_accessed_at, media.id IS NOT NULL
        FROM user_media_history media_history LEFT JOIN media_assets media ON media.id = media_history.media_id WHERE media_history.user_id = $1
      ), page_info AS (
        SELECT COUNT(*)::bigint AS total_items, GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages FROM history
      ), requested AS (
        SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.*, item.* FROM requested LEFT JOIN LATERAL (
        SELECT * FROM history ORDER BY last_accessed_at DESC, source ASC, history_id DESC
        LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [userId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL browse history metadata is missing");
  const items = result.rows.flatMap((row): PostgresBrowseHistoryItem[] => {
    if (row.history_id === null || row.source === null || row.item_id === null || row.title === null ||
        row.segment_index === null || row.visit_count === null || row.last_accessed_at === null || row.item_exists === null) return [];
    if (row.source !== "novel" && row.source !== "video" && row.source !== "audio" && row.source !== "file") throw new Error("Invalid PostgreSQL history source");
    return [{
      key: `${row.source === "novel" ? "novel" : "media"}:${positiveId(Number(row.history_id), "history id")}`,
      source: row.source, itemId: positiveId(Number(row.item_id), "history item id"), title: row.title,
      segmentIndex: integer(row.segment_index, "history segment"), visitCount: integer(row.visit_count, "history visits"),
      lastAccessedAt: timestamp(row.last_accessed_at, "history timestamp")!, itemExists: row.item_exists === true,
    }];
  });
  return { items, page: integer(first.page, "history page", 1), pageSize, totalItems: integer(first.total_items, "history total"), totalPages: integer(first.total_pages, "history pages", 1) };
}

export async function listPostgresUserLoginRecordsPage(
  executor: SqlExecutor, userIdValue: number, input: { page?: number; pageSize?: number } = {},
): Promise<PostgresPage<PostgresUserLoginRecord>> {
  const userId = positiveId(userIdValue, "user id");
  const pageSize = boundedPageSize(input.pageSize, 20);
  const requestedPage = Number.isFinite(input.page) ? Math.max(Math.floor(input.page ?? 1), 1) : 1;
  const result = await executor.query<PagedRow & {
    id: string | number | null; user_id: string | number | null; username: string | null; ip: string | null;
    user_agent: string | null; logged_at: Date | string | null;
  }>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items, GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages
        FROM user_login_records WHERE user_id = $1
      ), requested AS (
        SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.*, item.* FROM requested LEFT JOIN LATERAL (
        SELECT id, user_id, username, ip, user_agent, logged_at FROM user_login_records
        WHERE user_id = $1 ORDER BY logged_at DESC, id DESC LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [userId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL login record metadata is missing");
  const items = result.rows.flatMap((row): PostgresUserLoginRecord[] => row.id === null || row.username === null || row.ip === null || row.user_agent === null || row.logged_at === null ? [] : [{
    id: positiveId(Number(row.id), "login record id"), userId: row.user_id === null ? null : positiveId(Number(row.user_id), "login user id"),
    username: row.username, ip: row.ip, userAgent: row.user_agent, loggedAt: timestamp(row.logged_at, "login timestamp")!,
  }]);
  return { items, page: integer(first.page, "login page", 1), pageSize, totalItems: integer(first.total_items, "login total"), totalPages: integer(first.total_pages, "login pages", 1) };
}

function historyIds(keys: readonly string[]): { novel: number[]; media: number[] } {
  const novel = new Set<number>();
  const media = new Set<number>();
  for (const key of keys.slice(0, 500)) {
    const match = /^(novel|media):([1-9]\d*)$/u.exec(key);
    if (!match) continue;
    const id = Number(match[2]);
    if (!Number.isSafeInteger(id)) continue;
    (match[1] === "novel" ? novel : media).add(id);
  }
  return { novel: [...novel], media: [...media] };
}

export async function deletePostgresBrowseHistoryItems(
  userIdValue: number,
  keys: readonly string[],
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  const userId = positiveId(userIdValue, "user id");
  const ids = historyIds(keys);
  return transaction(async (tx) => {
    let deleted = 0;
    if (ids.novel.length) deleted += (await tx.query({ text: "DELETE FROM user_reading_history WHERE user_id = $1 AND id = ANY($2::bigint[])", values: [userId, ids.novel] })).rowCount ?? 0;
    if (ids.media.length) deleted += (await tx.query({ text: "DELETE FROM user_media_history WHERE user_id = $1 AND id = ANY($2::bigint[])", values: [userId, ids.media] })).rowCount ?? 0;
    return deleted;
  });
}

export async function clearPostgresBrowseHistory(
  userIdValue: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  const userId = positiveId(userIdValue, "user id");
  return transaction(async (tx) => {
    const novels = await tx.query({ text: "DELETE FROM user_reading_history WHERE user_id = $1", values: [userId] });
    const media = await tx.query({ text: "DELETE FROM user_media_history WHERE user_id = $1", values: [userId] });
    return (novels.rowCount ?? 0) + (media.rowCount ?? 0);
  });
}
