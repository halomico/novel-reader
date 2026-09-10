import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { getTelegramConfig } from "@/lib/telegram-config";

type TelegramMetadata = Readonly<{
  stationThreadId?: number;
  stationMessageId?: number;
}>;

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number; chat?: { id?: number | string } };
};

type OutboxRow = QueryResultRow & {
  id: string | number;
  method: string;
  payload_json: unknown;
  metadata_json: unknown;
  attempts: number;
};

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type QueueOptions = { dedupeKey?: string; metadata?: TelegramMetadata };

function positiveId(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("Invalid PostgreSQL " + label);
  return parsed;
}

function jsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid PostgreSQL Telegram payload");
  return parsed as Record<string, unknown>;
}

export async function queuePostgresTelegramText(
  executor: SqlExecutor,
  chatId: string,
  textValue: string,
  options: QueueOptions = {},
): Promise<boolean> {
  if (!getTelegramConfig()) return false;
  const text = textValue.trim();
  if (!chatId || !text) return false;
  const result = await executor.query({
    text: `INSERT INTO telegram_outbox
      (dedupe_key, method, payload_json, metadata_json, next_attempt_at)
      VALUES ($1, 'sendMessage', $2::jsonb, $3::jsonb, clock_timestamp())
      ON CONFLICT (dedupe_key) DO NOTHING`,
    values: [
      options.dedupeKey || null,
      JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4_000),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      JSON.stringify(options.metadata ?? {}),
    ],
  });
  return (result.rowCount ?? 0) > 0;
}

async function claimOutboxRows(executor: SqlExecutor, limit: number, leaseToken: string): Promise<OutboxRow[]> {
  const result = await executor.query<OutboxRow>({
    text: `WITH candidates AS (
        SELECT id FROM telegram_outbox
        WHERE status = 'pending' AND next_attempt_at <= clock_timestamp()
          AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
        ORDER BY id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1
      )
      UPDATE telegram_outbox outbox
      SET lease_token = $2, lease_expires_at = clock_timestamp() + INTERVAL '30 seconds'
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.method, outbox.payload_json, outbox.metadata_json, outbox.attempts`,
    values: [limit, leaseToken],
  });
  return result.rows;
}

async function completeOutboxRow(
  transaction: TransactionRunner,
  row: OutboxRow,
  leaseToken: string,
  response: TelegramApiResponse,
): Promise<boolean> {
  return transaction(async (tx) => {
    const result = await tx.query({
      text: `UPDATE telegram_outbox
        SET status = 'sent', attempts = attempts + 1, last_error = '', sent_at = clock_timestamp(),
          lease_token = NULL, lease_expires_at = NULL
        WHERE id = $1 AND status = 'pending' AND lease_token = $2`,
      values: [positiveId(row.id, "Telegram outbox id"), leaseToken],
    });
    if (result.rowCount !== 1) return false;
    const metadata = jsonObject(row.metadata_json) as TelegramMetadata;
    const chatId = response.result?.chat?.id;
    const messageId = response.result?.message_id;
    if (metadata.stationThreadId && chatId != null && Number.isSafeInteger(messageId) && Number(messageId) > 0) {
      await tx.query({
        text: `INSERT INTO telegram_message_links
          (chat_id, message_id, station_thread_id, station_message_id)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (chat_id, message_id) DO UPDATE SET
            station_thread_id = EXCLUDED.station_thread_id,
            station_message_id = EXCLUDED.station_message_id`,
        values: [String(chatId), messageId, metadata.stationThreadId, metadata.stationMessageId ?? null],
      });
    }
    return true;
  });
}

async function failOutboxRow(
  executor: SqlExecutor,
  row: OutboxRow,
  leaseToken: string,
  error: unknown,
): Promise<void> {
  const attempts = row.attempts + 1;
  const final = attempts >= 8;
  const delayMs = Math.min(15 * 60_000, 5_000 * (2 ** Math.min(attempts, 8)));
  await executor.query({
    text: `UPDATE telegram_outbox
      SET status = $3, attempts = $4,
        next_attempt_at = clock_timestamp() + ($5::integer * INTERVAL '1 millisecond'),
        last_error = $6, lease_token = NULL, lease_expires_at = NULL
      WHERE id = $1 AND status = 'pending' AND lease_token = $2`,
    values: [
      positiveId(row.id, "Telegram outbox id"),
      leaseToken,
      final ? "failed" : "pending",
      attempts,
      delayMs,
      (error instanceof Error ? error.message : "Telegram 请求失败").slice(0, 500),
    ],
  });
}

let processing = false;

export async function processPostgresTelegramOutbox(
  limitValue = 20,
  executor: SqlExecutor = database("jobs"),
  transaction: TransactionRunner = (operation) => withTransaction(operation, { role: "jobs" }),
): Promise<number> {
  const config = getTelegramConfig();
  if (!config || processing) return 0;
  processing = true;
  let sent = 0;
  const limit = Math.min(Math.max(Math.floor(limitValue), 1), 100);
  const leaseToken = crypto.randomUUID();
  try {
    const rows = await claimOutboxRows(executor, limit, leaseToken);
    for (const row of rows) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${row.method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: JSON.stringify(jsonObject(row.payload_json)),
          signal: AbortSignal.timeout(8_000),
        });
        const result = await response.json() as TelegramApiResponse;
        if (!response.ok || !result.ok) throw new Error(result.description || `HTTP ${response.status}`);
        if (await completeOutboxRow(transaction, row, leaseToken, result)) sent += 1;
      } catch (error) {
        await failOutboxRow(executor, row, leaseToken, error);
      }
    }
    return sent;
  } finally {
    processing = false;
  }
}
