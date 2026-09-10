import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, type SqlExecutor } from "@/core/db/postgres";

export const USER_SESSION_COOKIE = "novel_user_session";
export const USER_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{20,80}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const DEFAULT_LAST_SEEN_WRITE_INTERVAL_SECONDS = 300;

export type SessionPrincipal = Readonly<{
  id: number;
  username: string;
  displayName: string;
  email: string | null;
  emailVerifiedAt: string | null;
  avatarPath: string | null;
  status: "active" | "disabled" | "pending";
  role: "user" | "admin";
  trustLevel: number;
  sodaBalance: number;
  sodaExperience: number;
  cookieBalance: number;
  localePreference: "zh-Hans" | "zh-Hant";
  readingHistoryEnabled: boolean;
  originalReadingHistoryEnabled: boolean;
  readingProgressEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}>;

export type PostgresLoginUser = SessionPrincipal & Readonly<{ passwordHash: string }>;

/** Server-only credential. Never serialize this value into a user DTO or log. */
export type PostgresSessionCredential = Readonly<{
  cookieValue: string;
  expiresAt: string;
  maxAgeSeconds: number;
}>;

export type SessionRequestContext = {
  ip?: string | null;
  userAgent?: string | null;
};

export type PostgresIdentityRepositoryOptions = {
  lastSeenWriteIntervalSeconds?: number;
};

type ParsedSession = { id: string; token: string };

type PrincipalRow = QueryResultRow & {
  id: string | number;
  username: string;
  display_name: string;
  email: string | null;
  email_verified_at: Date | string | null;
  avatar_path: string | null;
  status: string;
  role: string;
  trust_level: number;
  soda_balance: string | number;
  soda_experience: string | number;
  cookie_balance: string | number;
  locale_preference: string;
  reading_history_enabled: boolean;
  original_reading_history_enabled: boolean;
  reading_progress_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
};

type LoginRow = PrincipalRow & { password_hash: string };

type ExpiryRow = QueryResultRow & { expires_at: Date | string };

function normalizeLastSeenInterval(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LAST_SEEN_WRITE_INTERVAL_SECONDS;
  if (!Number.isFinite(value)) throw new Error("Invalid session last-seen interval");
  return Math.min(Math.max(Math.floor(value), 30), 3_600);
}

function positiveSafeInteger(value: string | number, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL user ${field}`);
  return parsed;
}

function toIsoTimestamp(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL user ${field}`);
  return date.toISOString();
}

function nullableTimestamp(value: Date | string | null, field: string): string | null {
  return value === null ? null : toIsoTimestamp(value, field);
}

function boundedContextText(value: string | null | undefined, maximum: number): string | null {
  if (typeof value !== "string") return null;
  if (value.includes("\0") || !value.isWellFormed()) throw new Error("Invalid session request context");
  const normalized = Array.from(value.trim()).slice(0, maximum).join("");
  return normalized || null;
}

function validUserId(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid PostgreSQL user id");
  return value;
}

function boundedTtl(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Invalid session TTL");
  return Math.min(Math.max(Math.floor(value), 60), 90 * 24 * 60 * 60);
}

function toPrincipal(row: PrincipalRow): SessionPrincipal {
  if (row.role !== "user" && row.role !== "admin") throw new Error("Invalid PostgreSQL user role");
  if (row.locale_preference !== "zh-Hans" && row.locale_preference !== "zh-Hant") {
    throw new Error("Invalid PostgreSQL user locale");
  }
  if (row.status !== "active" && row.status !== "disabled" && row.status !== "pending") {
    throw new Error("Invalid PostgreSQL user status");
  }
  for (const flag of [row.reading_history_enabled, row.original_reading_history_enabled, row.reading_progress_enabled]) {
    if (typeof flag !== "boolean") throw new Error("Invalid PostgreSQL user preference");
  }
  const id = positiveSafeInteger(row.id, "id");
  if (id === 0) throw new Error("Invalid PostgreSQL user id");
  return Object.freeze({
    id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    emailVerifiedAt: nullableTimestamp(row.email_verified_at, "email_verified_at"),
    avatarPath: row.avatar_path,
    status: row.status,
    role: row.role,
    trustLevel: Math.min(Math.max(positiveSafeInteger(row.trust_level, "trust_level"), 1), 6),
    sodaBalance: positiveSafeInteger(row.soda_balance, "soda_balance"),
    sodaExperience: positiveSafeInteger(row.soda_experience, "soda_experience"),
    cookieBalance: positiveSafeInteger(row.cookie_balance, "cookie_balance"),
    localePreference: row.locale_preference,
    readingHistoryEnabled: row.reading_history_enabled === true,
    originalReadingHistoryEnabled: row.original_reading_history_enabled === true,
    readingProgressEnabled: row.reading_progress_enabled === true,
    createdAt: toIsoTimestamp(row.created_at, "created_at"),
    updatedAt: toIsoTimestamp(row.updated_at, "updated_at"),
    lastLoginAt: nullableTimestamp(row.last_login_at, "last_login_at"),
  });
}

function normalizedUsername(value: string): string {
  const username = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/u.test(username)) return "";
  return username;
}

function optionalPasswordHash(value: string | null): string | null {
  if (value === null) return null;
  if (value.length < 16 || value.length > 1_024 || value.includes("\0") || !value.isWellFormed()) {
    throw new Error("Invalid password hash");
  }
  return value;
}

export function parsePostgresSessionCookie(value: string | null | undefined): ParsedSession | null {
  if (typeof value !== "string" || value.length > 256) return null;
  const separator = value.indexOf(".");
  if (separator < 0 || separator !== value.lastIndexOf(".")) return null;
  const id = value.slice(0, separator);
  const token = value.slice(separator + 1);
  return SESSION_ID_PATTERN.test(id) && SESSION_TOKEN_PATTERN.test(token) ? { id, token } : null;
}

export function hashPostgresSessionToken(token: string): string {
  if (!SESSION_TOKEN_PATTERN.test(token)) throw new Error("Invalid session token");
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * PostgreSQL-only session repository. Authentication reads and the rate-limited
 * last-seen touch happen in one round trip, keeping navigation latency stable.
 */
export class PostgresIdentityRepository {
  readonly #executor: SqlExecutor;
  readonly #lastSeenWriteIntervalSeconds: number;

  constructor(
    executor: SqlExecutor = database("web"),
    options: PostgresIdentityRepositoryOptions = {},
  ) {
    this.#executor = executor;
    this.#lastSeenWriteIntervalSeconds = normalizeLastSeenInterval(options.lastSeenWriteIntervalSeconds);
  }

  async resolveSession(
    cookieValue: string | null | undefined,
    context: SessionRequestContext = {},
  ): Promise<SessionPrincipal | null> {
    const session = parsePostgresSessionCookie(cookieValue);
    if (!session) return null;
    const result = await this.#executor.query<PrincipalRow>({
      name: "identity-resolve-session-v1",
      text: `WITH valid_session AS MATERIALIZED (
               SELECT s.id AS session_id,
                      u.id, u.username, u.display_name, u.email, u.email_verified_at, u.avatar_path, u.status,
                      u.role, u.trust_level, u.soda_balance, u.soda_experience, u.cookie_balance,
                      u.locale_preference, u.reading_history_enabled, u.original_reading_history_enabled,
                      u.reading_progress_enabled, u.created_at, u.updated_at, u.last_login_at
               FROM user_sessions s
               JOIN users u ON u.id = s.user_id
               WHERE s.id = $1
                 AND s.token_hash = $2
                 AND s.expires_at > clock_timestamp()
                 AND u.status = 'active'
                 AND u.deleted_at IS NULL
             ), touch AS (
               UPDATE user_sessions s
               SET last_seen_at = clock_timestamp(),
                   last_ip = COALESCE($3, s.last_ip),
                   user_agent = COALESCE($4, s.user_agent)
               FROM valid_session v
               WHERE s.id = v.session_id
                 AND (s.last_seen_at IS NULL OR
                      s.last_seen_at <= clock_timestamp() - ($5::integer * interval '1 second'))
               RETURNING s.id
             )
             SELECT id, username, display_name, email, email_verified_at, avatar_path, status,
                    role, trust_level, soda_balance, soda_experience, cookie_balance,
                    locale_preference, reading_history_enabled, original_reading_history_enabled,
                    reading_progress_enabled, created_at, updated_at, last_login_at
             FROM valid_session`,
      values: [
        session.id,
        hashPostgresSessionToken(session.token),
        boundedContextText(context.ip, 128),
        boundedContextText(context.userAgent, 240),
        this.#lastSeenWriteIntervalSeconds,
      ],
    });
    const row = result.rows[0];
    return row ? toPrincipal(row) : null;
  }

  async findLoginUser(username: string): Promise<PostgresLoginUser | null> {
    const normalized = normalizedUsername(username);
    if (!normalized) return null;
    const result = await this.#executor.query<LoginRow>({
      name: "identity-find-login-user-v1",
      text: `SELECT id, username, display_name, email, email_verified_at, password_hash,
                    avatar_path, status, role, trust_level, soda_balance, soda_experience,
                    cookie_balance, locale_preference, reading_history_enabled,
                    original_reading_history_enabled, reading_progress_enabled,
                    created_at, updated_at, last_login_at
             FROM users
             WHERE username = $1 AND deleted_at IS NULL`,
      values: [normalized],
    });
    const row = result.rows[0];
    return row ? Object.freeze({ ...toPrincipal(row), passwordHash: row.password_hash }) : null;
  }

  async completeSuccessfulLogin(
    userId: number,
    input: SessionRequestContext & { passwordHash?: string | null; defaultAvatarPath: string },
  ): Promise<SessionPrincipal | null> {
    const passwordHash = optionalPasswordHash(input.passwordHash ?? null);
    const avatar = boundedContextText(input.defaultAvatarPath, 240);
    if (!avatar || !/^generated-avatar:[a-f0-9]{1,16}$/u.test(avatar)) throw new Error("Invalid default avatar path");
    const ip = boundedContextText(input.ip, 128) || "unknown";
    const userAgent = boundedContextText(input.userAgent, 240) || "";
    const result = await this.#executor.query<PrincipalRow>({
      name: "identity-complete-login-v1",
      text: `WITH updated AS MATERIALIZED (
               UPDATE users
               SET password_hash = coalesce($2, password_hash),
                   avatar_path = coalesce(nullif(btrim(avatar_path), ''), $3),
                   last_login_at = clock_timestamp(), last_login_ip = $4,
                   updated_at = clock_timestamp()
               WHERE id = $1 AND status = 'active' AND deleted_at IS NULL
               RETURNING id, username, display_name, email, email_verified_at, avatar_path, status,
                         role, trust_level, soda_balance, soda_experience, cookie_balance,
                         locale_preference, reading_history_enabled, original_reading_history_enabled,
                         reading_progress_enabled, created_at, updated_at, last_login_at
             ), audit AS (
               INSERT INTO user_login_records (user_id, username, ip, user_agent)
               SELECT id, username, $4, $5 FROM updated
               RETURNING id
             )
             SELECT updated.* FROM updated LEFT JOIN audit ON TRUE`,
      values: [validUserId(userId), passwordHash, avatar, ip, userAgent],
    });
    return result.rows[0] ? toPrincipal(result.rows[0]) : null;
  }

  async createSession(
    userId: number,
    context: SessionRequestContext = {},
    ttlSeconds = USER_SESSION_TTL_SECONDS,
  ): Promise<PostgresSessionCredential | null> {
    const normalizedUserId = validUserId(userId);
    const normalizedTtl = boundedTtl(ttlSeconds);
    const sessionId = crypto.randomBytes(18).toString("base64url");
    const token = crypto.randomBytes(32).toString("base64url");
    const result = await this.#executor.query<ExpiryRow>({
      name: "identity-create-session-v1",
      text: `INSERT INTO user_sessions (
               id, user_id, token_hash, expires_at, last_seen_at, last_ip, user_agent
             )
             SELECT $1, u.id, $3,
                    clock_timestamp() + ($4::integer * interval '1 second'),
                    clock_timestamp(), $5, $6
             FROM users u
             WHERE u.id = $2 AND u.status = 'active' AND u.deleted_at IS NULL
             RETURNING expires_at`,
      values: [
        sessionId,
        normalizedUserId,
        hashPostgresSessionToken(token),
        normalizedTtl,
        boundedContextText(context.ip, 128),
        boundedContextText(context.userAgent, 240),
      ],
    });
    const row = result.rows[0];
    if (!row) return null;
    return Object.freeze({
      cookieValue: `${sessionId}.${token}`,
      expiresAt: toIsoTimestamp(row.expires_at, "session expires_at"),
      maxAgeSeconds: normalizedTtl,
    });
  }

  async revokeSession(cookieValue: string | null | undefined): Promise<boolean> {
    const session = parsePostgresSessionCookie(cookieValue);
    if (!session) return false;
    const result = await this.#executor.query({
      name: "identity-revoke-session-v1",
      text: `DELETE FROM user_sessions
             WHERE id = $1 AND token_hash = $2`,
      values: [session.id, hashPostgresSessionToken(session.token)],
    });
    return (result.rowCount ?? 0) > 0;
  }

  async revokeAllUserSessions(userId: number): Promise<number> {
    const result = await this.#executor.query({
      name: "identity-revoke-user-sessions-v1",
      text: "DELETE FROM user_sessions WHERE user_id = $1",
      values: [validUserId(userId)],
    });
    return result.rowCount ?? 0;
  }

  async deleteExpiredSessions(limit = 1_000): Promise<number> {
    if (!Number.isFinite(limit)) throw new Error("Invalid expired-session deletion limit");
    const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 10_000);
    const result = await this.#executor.query({
      name: "identity-delete-expired-sessions-v1",
      text: `DELETE FROM user_sessions
             WHERE id IN (
               SELECT id FROM user_sessions
               WHERE expires_at <= clock_timestamp()
               ORDER BY expires_at, id
               LIMIT $1
               FOR UPDATE SKIP LOCKED
             )`,
      values: [boundedLimit],
    });
    return result.rowCount ?? 0;
  }
}
