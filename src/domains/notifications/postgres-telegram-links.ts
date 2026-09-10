import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { getTelegramConfig, isTelegramUserLinkAvailable } from "@/lib/telegram-config";

const LINK_TOKEN_MS = 10 * 60_000;

export type TelegramUserLink = Readonly<{
  chatId: string;
  username: string;
  linkedAt: string;
}>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type IdRow = QueryResultRow & { user_id: string | number };
type LinkRow = QueryResultRow & {
  chat_id: string;
  telegram_username: string;
  linked_at: Date | string;
};

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid PostgreSQL " + label);
  return value;
}

function mappedId(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return positiveId(parsed, label);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function timestamp(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL Telegram timestamp");
  return parsed.toISOString();
}

export async function createPostgresTelegramLinkUrl(
  userIdValue: number,
  now = Date.now(),
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<string | null> {
  const config = getTelegramConfig();
  if (!config?.botUsername || !isTelegramUserLinkAvailable()) return null;
  const userId = positiveId(userIdValue, "Telegram user id");
  const token = crypto.randomBytes(24).toString("base64url");
  const created = await transaction(async (tx) => {
    const result = await tx.query({
      text: "DELETE FROM telegram_link_tokens WHERE expires_at <= $1 OR user_id = $2",
      values: [new Date(now), userId],
    });
    await tx.query({
      text: `INSERT INTO telegram_link_tokens (token_hash, user_id, expires_at)
        SELECT $1, id, $3 FROM users
        WHERE id = $2 AND status = 'active' AND deleted_at IS NULL`,
      values: [hashToken(token), userId, new Date(now + LINK_TOKEN_MS)],
    });
    return (result.rowCount ?? 0) > 0;
  });
  return created ? `https://t.me/${config.botUsername}?start=link_${token}` : null;
}

export async function bindPostgresTelegramLinkToken(
  input: { token: string; chatId: string; username?: string; now?: number },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<{ ok: true; userId: number } | { ok: false }> {
  const now = input.now ?? Date.now();
  if (!/^[A-Za-z0-9_-]{32,80}$/u.test(input.token) || !/^-?\d+$/u.test(input.chatId)) return { ok: false };
  return transaction(async (tx) => {
    const result = await tx.query<IdRow>({
      text: `SELECT token.user_id FROM telegram_link_tokens token
        INNER JOIN users account ON account.id = token.user_id
        WHERE token.token_hash = $1 AND token.expires_at > $2
          AND account.status = 'active' AND account.deleted_at IS NULL
        FOR UPDATE OF token`,
      values: [hashToken(input.token), new Date(now)],
    });
    if (!result.rows[0]) return { ok: false };
    const userId = mappedId(result.rows[0].user_id, "Telegram linked user id");
    await tx.query({
      text: "DELETE FROM telegram_user_links WHERE user_id = $1 OR chat_id = $2",
      values: [userId, input.chatId],
    });
    await tx.query({
      text: `INSERT INTO telegram_user_links (user_id, chat_id, telegram_username)
        VALUES ($1, $2, $3)`,
      values: [userId, input.chatId, String(input.username || "").replace(/^@/u, "").slice(0, 64)],
    });
    await tx.query({ text: "DELETE FROM telegram_link_tokens WHERE user_id = $1", values: [userId] });
    return { ok: true, userId };
  });
}

export async function getPostgresTelegramUserLink(
  executor: SqlExecutor,
  userIdValue: number,
): Promise<TelegramUserLink | null> {
  const result = await executor.query<LinkRow>({
    name: "notifications-get-telegram-user-link-v1",
    text: `SELECT chat_id, telegram_username, linked_at
      FROM telegram_user_links WHERE user_id = $1`,
    values: [positiveId(userIdValue, "Telegram user id")],
  });
  const row = result.rows[0];
  return row ? {
    chatId: row.chat_id,
    username: row.telegram_username,
    linkedAt: timestamp(row.linked_at),
  } : null;
}

export async function unlinkPostgresTelegramUser(executor: SqlExecutor, userIdValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM telegram_user_links WHERE user_id = $1",
    values: [positiveId(userIdValue, "Telegram user id")],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function getPostgresTelegramLinkedUserId(executor: SqlExecutor, chatId: string): Promise<number | null> {
  if (!/^-?\d+$/u.test(chatId)) return null;
  const result = await executor.query<IdRow>({
    name: "notifications-get-telegram-linked-user-v1",
    text: "SELECT user_id FROM telegram_user_links WHERE chat_id = $1",
    values: [chatId],
  });
  return result.rows[0] ? mappedId(result.rows[0].user_id, "Telegram linked user id") : null;
}

export async function getPostgresStationThreadForTelegramReply(
  executor: SqlExecutor,
  chatId: string,
  messageIdValue: number,
): Promise<number | null> {
  if (!/^-?\d+$/u.test(chatId)) return null;
  const messageId = positiveId(messageIdValue, "Telegram message id");
  const result = await executor.query<QueryResultRow & { station_thread_id: string | number }>({
    name: "notifications-get-telegram-reply-thread-v1",
    text: `SELECT station_thread_id FROM telegram_message_links
      WHERE chat_id = $1 AND message_id = $2`,
    values: [chatId, messageId],
  });
  return result.rows[0] ? mappedId(result.rows[0].station_thread_id, "station thread id") : null;
}

export async function claimPostgresTelegramUpdate(executor: SqlExecutor, updateIdValue: number): Promise<boolean> {
  const updateId = positiveId(updateIdValue, "Telegram update id");
  const result = await executor.query({
    text: `INSERT INTO telegram_updates (update_id) VALUES ($1)
      ON CONFLICT (update_id) DO NOTHING`,
    values: [updateId],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function releasePostgresTelegramUpdate(executor: SqlExecutor, updateIdValue: number): Promise<void> {
  await executor.query({
    text: "DELETE FROM telegram_updates WHERE update_id = $1",
    values: [positiveId(updateIdValue, "Telegram update id")],
  });
}
