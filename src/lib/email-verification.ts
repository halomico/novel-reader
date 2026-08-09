import crypto from "node:crypto";
import { getSiteName } from "./config";
import { getDb } from "./db";
import { isMailConfigured, sendMail } from "./mail";
import { normalizeEmail } from "./users";

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
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      `DELETE FROM email_verification_tokens
       WHERE user_id = ? AND consumed_at IS NULL`,
    ).run(input.userId);
    db.prepare(
      `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
       VALUES (?, ?, ?)`,
    ).run(input.userId, tokenHash(token), expiresAt);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  const siteName = getSiteName();
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

export function verifyEmailToken(tokenValue: string): boolean {
  const token = tokenValue.trim();
  if (token.length < 32 || token.length > 160) return false;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT id, user_id
         FROM email_verification_tokens
         WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
      )
      .get(tokenHash(token), Date.now()) as { id: number; user_id: number } | undefined;
    if (!row) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare(
      `UPDATE users
       SET email_verified_at = CURRENT_TIMESTAMP,
           status = CASE WHEN status = 'pending' THEN 'active' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(row.user_id);
    db.prepare(
      "UPDATE email_verification_tokens SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(row.id);
    db.prepare(
      `DELETE FROM email_verification_tokens
       WHERE user_id = ? AND id <> ?`,
    ).run(row.user_id, row.id);
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function resendVerificationEmail(emailValue: string, requestOrigin: string): Promise<void> {
  const email = normalizeEmail(emailValue);
  const user = getDb()
    .prepare(
      `SELECT id, email, display_name
       FROM users
       WHERE email = ? COLLATE NOCASE AND status = 'pending' AND email_verified_at IS NULL`,
    )
    .get(email) as { id: number; email: string; display_name: string } | undefined;
  if (!user) return;
  const recent = getDb()
    .prepare(
      `SELECT created_at
       FROM email_verification_tokens
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(user.id) as { created_at: string } | undefined;
  if (recent && Date.now() - Date.parse(`${recent.created_at}Z`) < 60_000) return;
  await sendUserVerificationEmail({
    userId: user.id,
    email: user.email,
    displayName: user.display_name,
    requestOrigin,
  });
}
