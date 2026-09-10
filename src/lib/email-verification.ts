import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { normalizeEmail } from "@/domains/identity/account-input";
import { isMailConfigured, sendMail } from "./mail";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicOrigin(originValue: string): string {
  const configured = (process.env.SITE_URL || "").trim();
  const candidates = process.env.NODE_ENV === "production" ? [configured] : [configured, originValue];
  for (const value of candidates) {
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
        return url.origin;
      }
    } catch {
      // Try the next source.
    }
  }
  throw new Error("站点公开地址未配置");
}

export function isEmailVerificationConfigured(): boolean {
  if (!isMailConfigured()) return false;
  try {
    publicOrigin("");
    return true;
  } catch {
    return false;
  }
}

export async function sendUserVerificationEmail(input: {
  userId: number;
  email: string;
  displayName: string;
  requestOrigin: string;
}): Promise<void> {
  const token = await createPostgresEmailVerificationToken(input.userId, false);
  if (!token) throw new Error("Cannot issue an email verification token for this user");
  const siteName = (await readPostgresSiteSettings()).siteName || "Novel Reader";
  const verifyUrl = `${publicOrigin(input.requestOrigin)}/verify-email?token=${encodeURIComponent(token)}`;
  const displayName = input.displayName.trim() || "读者";
  await sendMail({
    to: normalizeEmail(input.email),
    subject: `验证你的 ${siteName} 账号`,
    text: `${displayName}，你好。\n\n请在 24 小时内打开以下链接完成邮箱验证：\n${verifyUrl}\n\n如果这不是你的操作，可以忽略这封邮件。`,
    html: [
      `<p>${escapeHtml(displayName)}，你好。</p>`,
      `<p>请在 24 小时内完成 <strong>${escapeHtml(siteName)}</strong> 邮箱验证。</p>`,
      `<p><a href="${escapeHtml(verifyUrl)}">验证邮箱</a></p>`,
      "<p>如果这不是你的操作，可以忽略这封邮件。</p>",
    ].join(""),
  });
}

export async function verifyEmailToken(tokenValue: string): Promise<boolean> {
  const token = tokenValue.trim();
  if (token.length < 32 || token.length > 160) return false;
  const result = await database("web").query<QueryResultRow & { verified: boolean }>({
    text: `WITH claimed AS MATERIALIZED (
        UPDATE email_verification_tokens SET consumed_at = clock_timestamp()
        WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > clock_timestamp()
        RETURNING id, user_id
      ), activated AS MATERIALIZED (
        UPDATE users account SET
          email_verified_at = clock_timestamp(),
          status = CASE WHEN account.status = 'pending' THEN 'active' ELSE account.status END,
          updated_at = clock_timestamp()
        FROM claimed WHERE account.id = claimed.user_id AND account.deleted_at IS NULL
        RETURNING account.id
      ), cleaned AS (
        DELETE FROM email_verification_tokens token USING claimed
        WHERE token.user_id = claimed.user_id AND token.id <> claimed.id
        RETURNING token.id
      )
      SELECT EXISTS (SELECT 1 FROM activated) AS verified`,
    values: [tokenHash(token)],
  });
  return result.rows[0]?.verified === true;
}

export async function resendVerificationEmail(emailValue: string, requestOrigin: string): Promise<void> {
  const email = normalizeEmail(emailValue);
  const users = await database("web").query<QueryResultRow & { id: string | number; email: string; display_name: string }>({
    text: `SELECT id, email, display_name FROM users
      WHERE lower(email) = lower($1) AND status = 'pending' AND email_verified_at IS NULL AND deleted_at IS NULL`,
    values: [email],
  });
  const user = users.rows[0];
  if (!user) return;
  const userId = Number(user.id);
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Invalid PostgreSQL email verification user id");
  const token = await createPostgresEmailVerificationToken(userId, true);
  if (!token) return;
  const siteName = (await readPostgresSiteSettings()).siteName || "Novel Reader";
  const verifyUrl = `${publicOrigin(requestOrigin)}/verify-email?token=${encodeURIComponent(token)}`;
  const displayName = user.display_name.trim() || "读者";
  await sendMail({
    to: normalizeEmail(user.email),
    subject: `验证你的 ${siteName} 账号`,
    text: `${displayName}，你好。\n\n请在 24 小时内打开以下链接完成邮箱验证：\n${verifyUrl}\n\n如果这不是你的操作，可以忽略这封邮件。`,
    html: [
      `<p>${escapeHtml(displayName)}，你好。</p>`,
      `<p>请在 24 小时内完成 <strong>${escapeHtml(siteName)}</strong> 邮箱验证。</p>`,
      `<p><a href="${escapeHtml(verifyUrl)}">验证邮箱</a></p>`,
      "<p>如果这不是你的操作，可以忽略这封邮件。</p>",
    ].join(""),
  });
}

async function createPostgresEmailVerificationToken(
  userId: number,
  enforceCooldown: boolean,
  transaction: <T>(operation: (executor: SqlExecutor) => Promise<T>) => Promise<T> = (operation) => withTransaction(operation),
): Promise<string | null> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new TypeError("Invalid PostgreSQL email verification user id");
  const token = crypto.randomBytes(32).toString("base64url");
  return transaction(async (tx) => {
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      values: [`email-verification:${userId}`],
    });
    if (enforceCooldown) {
      const recent = await tx.query({
        text: `SELECT 1 FROM email_verification_tokens
          WHERE user_id = $1 AND created_at > clock_timestamp() - interval '60 seconds'
          LIMIT 1`,
        values: [userId],
      });
      if (recent.rowCount) return null;
    }
    await tx.query({
      text: "DELETE FROM email_verification_tokens WHERE user_id = $1 AND consumed_at IS NULL",
      values: [userId],
    });
    const inserted = await tx.query({
      text: `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
        SELECT id, $2, clock_timestamp() + ($3::double precision * interval '1 millisecond')
        FROM users WHERE id = $1 AND deleted_at IS NULL
        RETURNING id`,
      values: [userId, tokenHash(token), TOKEN_TTL_MS],
    });
    return inserted.rowCount === 1 ? token : null;
  });
}
