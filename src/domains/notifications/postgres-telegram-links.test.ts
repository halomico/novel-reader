import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import type { SqlExecutor, SqlQuery } from "@/core/db/postgres";
import { getTelegramConfig } from "@/lib/telegram-config";
import {
  bindPostgresTelegramLinkToken,
  claimPostgresTelegramUpdate,
  createPostgresTelegramLinkUrl,
  getPostgresTelegramUserLink,
} from "./postgres-telegram-links";

function queued(
  responses: Array<{ rows?: QueryResultRow[]; rowCount?: number }>,
  captured: SqlQuery[],
): SqlExecutor {
  return {
    async query<Row extends QueryResultRow>(query: SqlQuery) {
      captured.push(query);
      const response = responses.shift() ?? {};
      const rows = response.rows ?? [];
      return {
        command: "SELECT", rowCount: response.rowCount ?? rows.length,
        oid: 0, fields: [], rows,
      } as unknown as QueryResult<Row>;
    },
  };
}

test("Telegram configuration remains optional and validates webhook settings", () => {
  assert.equal(getTelegramConfig({} as NodeJS.ProcessEnv), null);
  const config = getTelegramConfig({
    TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG",
    TELEGRAM_BOT_USERNAME: "reader_notice_bot",
    TELEGRAM_WEBHOOK_SECRET: "telegram_webhook_secret_123456",
    TELEGRAM_ADMIN_CHAT_IDS: "-10001,invalid,-10001",
    TELEGRAM_ADMIN_USER_IDS: "123,456",
    SITE_URL: "https://reader.example.com/path",
  } as unknown as NodeJS.ProcessEnv)!;
  assert.deepEqual(config.adminChatIds, ["-10001"]);
  assert.deepEqual([...config.adminUserIds], [123, 456]);
  assert.equal(config.webhookUrl, "https://reader.example.com/api/telegram/webhook");
});

test("PostgreSQL Telegram link creation replaces stale tokens transactionally", async (t) => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwxyz_ABCDEFG",
    TELEGRAM_BOT_USERNAME: "reader_notice_bot",
    TELEGRAM_WEBHOOK_SECRET: "telegram_webhook_secret_123456",
    SITE_URL: "https://reader.example.com",
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  const captured: SqlQuery[] = [];
  const executor = queued([{ rowCount: 1 }, { rowCount: 1 }], captured);
  const url = await createPostgresTelegramLinkUrl(7, 1_800_000_000_000, async (operation) => operation(executor));
  assert.match(url ?? "", /^https:\/\/t\.me\/reader_notice_bot\?start=link_/u);
  assert.match(captured[0].text, /DELETE FROM telegram_link_tokens/u);
  assert.match(captured[1].text, /status = 'active'/u);
});

test("PostgreSQL Telegram token binding consumes the token in one transaction", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ user_id: "9" }] }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
  ], captured);
  const result = await bindPostgresTelegramLinkToken({
    token: "a".repeat(32), chatId: "777", username: "reader_tg", now: 1_800_000_000_000,
  }, async (operation) => operation(executor));
  assert.deepEqual(result, { ok: true, userId: 9 });
  assert.match(captured[0].text, /FOR UPDATE OF token/u);
  assert.match(captured[3].text, /DELETE FROM telegram_link_tokens/u);
});

test("PostgreSQL Telegram reads and update claims are parameterized", async () => {
  const captured: SqlQuery[] = [];
  const executor = queued([
    { rows: [{ chat_id: "777", telegram_username: "reader", linked_at: "2026-09-08T00:00:00Z" }] },
    { rowCount: 1 },
  ], captured);
  const link = await getPostgresTelegramUserLink(executor, 4);
  assert.equal(link?.username, "reader");
  assert.equal(await claimPostgresTelegramUpdate(executor, 99), true);
  assert.match(captured[1].text, /ON CONFLICT/u);
});
