import crypto from "node:crypto";
import { getDb } from "./db";
import { getTelegramConfig, isTelegramUserLinkAvailable } from "./telegram-config";

const LINK_TOKEN_MS = 10 * 60_000;

export type TelegramUserLink = {
  chatId: string;
  username: string;
  linkedAt: string;
};

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createTelegramLinkUrl(userId: number, now = Date.now()): string | null {
  const config = getTelegramConfig();
  if (!config?.botUsername || !isTelegramUserLinkAvailable()) return null;
  const token = crypto.randomBytes(24).toString("base64url");
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM telegram_link_tokens WHERE expires_at <= ? OR user_id = ?").run(now, userId);
    db.prepare("INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
      .run(hashToken(token), userId, now + LINK_TOKEN_MS);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return `https://t.me/${config.botUsername}?start=link_${token}`;
}

export function bindTelegramLinkToken(input: {
  token: string;
  chatId: string;
  username?: string;
  now?: number;
}): { ok: true; userId: number } | { ok: false } {
  const now = input.now ?? Date.now();
  if (!/^[A-Za-z0-9_-]{32,80}$/.test(input.token) || !/^-?\d+$/.test(input.chatId)) return { ok: false };
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const token = db.prepare(
      `SELECT t.user_id
       FROM telegram_link_tokens t
       INNER JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ? AND t.expires_at > ? AND u.status = 'active'`,
    ).get(hashToken(input.token), now) as { user_id: number } | undefined;
    if (!token) {
      db.exec("ROLLBACK");
      return { ok: false };
    }
    db.prepare("DELETE FROM telegram_user_links WHERE user_id = ? OR chat_id = ?")
      .run(token.user_id, input.chatId);
    db.prepare(
      `INSERT INTO telegram_user_links (user_id, chat_id, telegram_username)
       VALUES (?, ?, ?)`,
    ).run(token.user_id, input.chatId, String(input.username || "").replace(/^@/, "").slice(0, 64));
    db.prepare("DELETE FROM telegram_link_tokens WHERE user_id = ?").run(token.user_id);
    db.exec("COMMIT");
    return { ok: true, userId: token.user_id };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getTelegramUserLink(userId: number): TelegramUserLink | null {
  const row = getDb().prepare(
    "SELECT chat_id, telegram_username, linked_at FROM telegram_user_links WHERE user_id = ?",
  ).get(userId) as { chat_id: string; telegram_username: string; linked_at: string } | undefined;
  return row ? { chatId: row.chat_id, username: row.telegram_username, linkedAt: row.linked_at } : null;
}

export function unlinkTelegramUser(userId: number): boolean {
  return getDb().prepare("DELETE FROM telegram_user_links WHERE user_id = ?").run(userId).changes > 0;
}

export function getTelegramLinkedUserId(chatId: string): number | null {
  const row = getDb().prepare("SELECT user_id FROM telegram_user_links WHERE chat_id = ?")
    .get(chatId) as { user_id: number } | undefined;
  return row?.user_id || null;
}

export function getStationThreadForTelegramReply(chatId: string, messageId: number): number | null {
  const row = getDb().prepare(
    "SELECT station_thread_id FROM telegram_message_links WHERE chat_id = ? AND message_id = ?",
  ).get(chatId, messageId) as { station_thread_id: number } | undefined;
  return row?.station_thread_id || null;
}

export function claimTelegramUpdate(updateId: number): boolean {
  return getDb().prepare("INSERT OR IGNORE INTO telegram_updates (update_id) VALUES (?)")
    .run(updateId).changes > 0;
}

export function releaseTelegramUpdate(updateId: number) {
  getDb().prepare("DELETE FROM telegram_updates WHERE update_id = ?").run(updateId);
}
