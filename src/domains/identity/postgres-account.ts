import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { normalizeEmail, normalizeUsername } from "./account-input";

export type PostgresRegistrationMode = "open" | "invite";
export type PostgresRegistrationResult =
  | Readonly<{ ok: true; userId: number }>
  | Readonly<{ ok: false; reason: "daily_limit" | "invalid_invite" | "username_conflict" | "email_conflict" }>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

type IdRow = QueryResultRow & { id: string | number };
type CountRow = QueryResultRow & { count: string | number };
type PasswordRow = QueryResultRow & { password_hash: string };

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function safeCount(value: string | number | undefined, label: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function cleanText(value: string, maximum: number, label: string): string {
  if (!value.isWellFormed() || value.includes("\0")) throw new TypeError(`Invalid PostgreSQL ${label}`);
  const normalized = value.trim();
  if (Array.from(normalized).length > maximum) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return normalized;
}

function inviteSecret(): string {
  const value = process.env.REGISTRATION_INVITE_SECRET || process.env.MARKET_SECRET_KEY || process.env.ADMIN_SESSION_SECRET || "";
  if (value.length < 32) throw new Error("请先配置 REGISTRATION_INVITE_SECRET");
  return value;
}

function inviteHash(codeValue: string): string | null {
  const code = codeValue.trim().toLocaleUpperCase("en-US").replace(/\s+/gu, "");
  if (code.length < 10 || code.length > 200 || !code.isWellFormed() || code.includes("\0")) return null;
  return crypto.createHmac("sha256", inviteSecret()).update(code).digest("hex");
}

function conflictConstraint(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && typeof candidate.constraint === "string" ? candidate.constraint : "";
}

export async function countPostgresRegistrationsForIpToday(
  executor: SqlExecutor,
  ipValue: string,
): Promise<number> {
  const ip = cleanText(ipValue, 128, "registration ip") || "unknown";
  const result = await executor.query<CountRow>({
    name: "identity-registration-count-today-v1",
    text: `SELECT COUNT(*)::bigint AS count FROM users
      WHERE registration_ip = $1
        AND created_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
        AND created_at < (date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Shanghai') + interval '1 day') AT TIME ZONE 'Asia/Shanghai'`,
    values: [ip],
  });
  return safeCount(result.rows[0]?.count, "registration count");
}

export async function registerPostgresUser(
  input: {
    username: string;
    displayName: string;
    email?: string | null;
    passwordHash: string;
    status: "active" | "pending";
    localePreference: "zh-Hans" | "zh-Hant";
    registrationIp: string;
    registrationMode: PostgresRegistrationMode;
    inviteCode?: string;
    dailyLimit?: number;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation, { isolation: "read committed", lockTimeoutMs: 2_000 }),
): Promise<PostgresRegistrationResult> {
  const username = normalizeUsername(input.username);
  const displayName = cleanText(input.displayName, 40, "display name");
  const email = input.email ? normalizeEmail(input.email) : null;
  const passwordHash = cleanText(input.passwordHash, 1_024, "password hash");
  const registrationIp = cleanText(input.registrationIp, 128, "registration ip") || "unknown";
  const dailyLimit = Number.isFinite(input.dailyLimit) ? Math.min(Math.max(Math.floor(input.dailyLimit ?? 0), 0), 100) : 0;
  const codeHash = input.registrationMode === "invite" ? inviteHash(input.inviteCode ?? "") : null;
  if (input.registrationMode === "invite" && !codeHash) return { ok: false, reason: "invalid_invite" };

  try {
    return await transaction(async (tx) => {
      await tx.query({
        text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        values: [`registration:${registrationIp}:${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })}`],
      });
      if (dailyLimit > 0 && await countPostgresRegistrationsForIpToday(tx, registrationIp) >= dailyLimit) {
        return { ok: false, reason: "daily_limit" };
      }
      if (codeHash) {
        const consumed = await tx.query({
          text: `UPDATE registration_invites SET used_count = used_count + 1
            WHERE id = (
              SELECT id FROM registration_invites
              WHERE code_hash = $1 AND enabled = TRUE AND used_count < max_uses
                AND (expires_at IS NULL OR expires_at > clock_timestamp())
              FOR UPDATE
            )
            RETURNING id`,
          values: [codeHash],
        });
        if (!consumed.rowCount) return { ok: false, reason: "invalid_invite" };
      }
      const inserted = await tx.query<IdRow>({
        text: `INSERT INTO users
          (username, display_name, email, password_hash, status, role, trust_level,
           locale_preference, registration_ip, updated_at)
          VALUES ($1, $2, $3, $4, $5, 'user',
            COALESCE((SELECT MAX(level) FROM user_levels WHERE soda_required <= 0), 1),
            $6, $7, clock_timestamp())
          RETURNING id`,
        values: [username, displayName, email, passwordHash, input.status, input.localePreference, registrationIp],
      });
      const userId = Number(inserted.rows[0]?.id);
      return { ok: true, userId: positiveId(userId, "registered user id") };
    });
  } catch (error) {
    const constraint = conflictConstraint(error);
    if (constraint === "users_username_key" || constraint === "idx_users_username") {
      return { ok: false, reason: "username_conflict" };
    }
    if (constraint === "idx_users_email_unique") return { ok: false, reason: "email_conflict" };
    throw error;
  }
}

export async function findPostgresUserIdByEmail(executor: SqlExecutor, emailValue: string): Promise<number | null> {
  const result = await executor.query<IdRow>({
    name: "identity-user-id-by-email-v1",
    text: "SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL",
    values: [normalizeEmail(emailValue)],
  });
  return result.rows[0] ? positiveId(Number(result.rows[0].id), "email user id") : null;
}

export async function updatePostgresUserAvatar(executor: SqlExecutor, userIdValue: number, avatarPathValue: string | null): Promise<boolean> {
  const avatarPath = avatarPathValue === null ? null : cleanText(avatarPathValue, 240, "avatar path");
  const result = await executor.query({
    text: "UPDATE users SET avatar_path = $2, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL",
    values: [positiveId(userIdValue, "user id"), avatarPath],
  });
  return result.rowCount === 1;
}

export async function updatePostgresUserDisplayName(executor: SqlExecutor, userIdValue: number, displayNameValue: string): Promise<boolean> {
  const result = await executor.query({
    text: "UPDATE users SET display_name = $2, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL",
    values: [positiveId(userIdValue, "user id"), cleanText(displayNameValue, 40, "display name")],
  });
  return result.rowCount === 1;
}

export async function updatePostgresUserEmail(
  userIdValue: number,
  emailValue: string | null,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<"updated" | "conflict" | "not_found"> {
  const userId = positiveId(userIdValue, "user id");
  const email = emailValue ? normalizeEmail(emailValue) : null;
  try {
    return await transaction(async (tx) => {
      const result = await tx.query({
        text: `UPDATE users SET email = $2, email_verified_at = NULL, updated_at = clock_timestamp()
          WHERE id = $1 AND deleted_at IS NULL`,
        values: [userId, email],
      });
      if (result.rowCount !== 1) return "not_found";
      await tx.query({ text: "DELETE FROM email_verification_tokens WHERE user_id = $1", values: [userId] });
      return "updated";
    });
  } catch (error) {
    if (conflictConstraint(error) === "idx_users_email_unique") return "conflict";
    throw error;
  }
}

export async function getPostgresUserPasswordHash(executor: SqlExecutor, userIdValue: number): Promise<string | null> {
  const result = await executor.query<PasswordRow>({
    name: "identity-user-password-hash-v1",
    text: "SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL",
    values: [positiveId(userIdValue, "user id")],
  });
  return result.rows[0]?.password_hash ?? null;
}

export async function replacePostgresUserPassword(
  userIdValue: number,
  passwordHashValue: string,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<boolean> {
  const userId = positiveId(userIdValue, "user id");
  const passwordHash = cleanText(passwordHashValue, 1_024, "password hash");
  return transaction(async (tx) => {
    const updated = await tx.query({
      text: "UPDATE users SET password_hash = $2, updated_at = clock_timestamp() WHERE id = $1 AND deleted_at IS NULL",
      values: [userId, passwordHash],
    });
    if (updated.rowCount !== 1) return false;
    await tx.query({ text: "DELETE FROM user_sessions WHERE user_id = $1", values: [userId] });
    return true;
  });
}

export async function updatePostgresUserPreferences(
  executor: SqlExecutor,
  userIdValue: number,
  input: {
    localePreference?: "zh-Hans" | "zh-Hant" | null;
    readingHistoryKind?: "novel" | "original" | null;
    readingHistoryEnabled?: boolean;
  },
): Promise<boolean> {
  const locale = input.localePreference ?? null;
  const kind = input.readingHistoryKind ?? null;
  if (locale !== null && locale !== "zh-Hans" && locale !== "zh-Hant") throw new TypeError("Invalid PostgreSQL locale preference");
  if (kind !== null && kind !== "novel" && kind !== "original") throw new TypeError("Invalid PostgreSQL history preference kind");
  if (kind !== null && typeof input.readingHistoryEnabled !== "boolean") throw new TypeError("Invalid PostgreSQL history preference");
  if (locale === null && kind === null) return false;
  const result = await executor.query({
    text: `UPDATE users SET
        locale_preference = COALESCE($2::text, locale_preference),
        reading_history_enabled = CASE WHEN $3::text = 'novel' THEN $4::boolean ELSE reading_history_enabled END,
        original_reading_history_enabled = CASE WHEN $3::text = 'original' THEN $4::boolean ELSE original_reading_history_enabled END,
        updated_at = clock_timestamp()
      WHERE id = $1 AND deleted_at IS NULL`,
    values: [positiveId(userIdValue, "user id"), locale, kind, kind === null ? null : input.readingHistoryEnabled],
  });
  return result.rowCount === 1;
}
