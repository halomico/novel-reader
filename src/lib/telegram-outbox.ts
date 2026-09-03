import { getDb } from "./db";
import { getTelegramConfig } from "./telegram-config";

type TelegramMetadata = {
  stationThreadId?: number;
  stationMessageId?: number;
};

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
  result?: { message_id?: number; chat?: { id?: number | string } };
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function enqueue(
  method: string,
  payload: Record<string, unknown>,
  dedupeKey: string | null,
  metadata: TelegramMetadata = {},
): boolean {
  if (!getTelegramConfig()) return false;
  return getDb().prepare(
    `INSERT OR IGNORE INTO telegram_outbox (
       dedupe_key, method, payload_json, metadata_json, next_attempt_at
     ) VALUES (?, ?, ?, ?, ?)`,
  ).run(dedupeKey, method, JSON.stringify(payload), JSON.stringify(metadata), Date.now()).changes > 0;
}

export function queueTelegramText(
  chatId: string,
  text: string,
  options: { dedupeKey?: string; metadata?: TelegramMetadata } = {},
): boolean {
  if (!chatId || !text.trim()) return false;
  return enqueue("sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4_000),
    parse_mode: "HTML",
    disable_web_page_preview: true,
  }, options.dedupeKey || null, options.metadata);
}

export function queueStationTelegramNotification(
  threadId: number,
  messageId: number,
  authorRole: "user" | "admin",
) {
  const config = getTelegramConfig();
  if (!config) return;
  const row = getDb().prepare(
    `SELECT t.subject, t.user_id, u.username, u.display_name, m.body
     FROM station_threads t
     INNER JOIN users u ON u.id = t.user_id
     INNER JOIN station_messages m ON m.thread_id = t.id AND m.id = ?
     WHERE t.id = ?`,
  ).get(messageId, threadId) as {
    subject: string;
    user_id: number;
    username: string;
    display_name: string;
    body: string;
  } | undefined;
  if (!row) return;

  if (authorRole === "user") {
    const text = [
      `<b>站务消息</b> · ${escapeHtml(row.subject)}`,
      `${escapeHtml(row.display_name)} (@${escapeHtml(row.username)})`,
      "",
      escapeHtml(row.body),
      "",
      "直接回复此消息即可回信。",
    ].join("\n");
    for (const chatId of config.adminChatIds) {
      queueTelegramText(chatId, text, {
        dedupeKey: `station-admin:${messageId}:${chatId}`,
        metadata: { stationThreadId: threadId, stationMessageId: messageId },
      });
    }
    return;
  }

  const link = getDb().prepare("SELECT chat_id FROM telegram_user_links WHERE user_id = ?")
    .get(row.user_id) as { chat_id: string } | undefined;
  if (!link) return;
  queueTelegramText(link.chat_id, [
    `<b>站务回复</b> · ${escapeHtml(row.subject)}`,
    "",
    escapeHtml(row.body),
    "",
    "直接回复此消息可继续对话。",
  ].join("\n"), {
    dedupeKey: `station-user:${messageId}:${link.chat_id}`,
    metadata: { stationThreadId: threadId, stationMessageId: messageId },
  });
}

export function queueReportTelegramNotification(reportId: number) {
  const config = getTelegramConfig();
  if (!config?.adminChatIds.length) return;
  const report = getDb().prepare(
    `SELECT r.category, r.details, u.username, u.display_name,
            COALESCE(n.title, m.title, a.title, '已删除内容') AS target_title
     FROM content_reports r
     INNER JOIN users u ON u.id = r.user_id
     LEFT JOIN novels n ON n.id = r.novel_id
     LEFT JOIN media_assets m ON m.id = r.media_id
     LEFT JOIN original_articles a ON a.id = r.original_article_id
     WHERE r.id = ?`,
  ).get(reportId) as {
    category: string;
    details: string;
    username: string;
    display_name: string;
    target_title: string;
  } | undefined;
  if (!report) return;
  const text = [
    `<b>内容反馈</b> · ${escapeHtml(report.target_title)}`,
    `${escapeHtml(report.display_name)} (@${escapeHtml(report.username)}) · ${escapeHtml(report.category)}`,
    report.details ? `\n${escapeHtml(report.details)}` : "",
  ].join("\n");
  for (const chatId of config.adminChatIds) {
    queueTelegramText(chatId, text, { dedupeKey: `report:${reportId}:${chatId}` });
  }
}

export function queueAnnouncementTelegramNotification(input: {
  id: number;
  title: string;
  body: string;
}) {
  const chatId = getTelegramConfig()?.announcementChatId;
  if (!chatId) return;
  queueTelegramText(chatId, [
    `<b>${escapeHtml(input.title)}</b>`,
    "",
    escapeHtml(input.body).slice(0, 3_500),
  ].join("\n"), { dedupeKey: `announcement:${input.id}` });
}

let processing = false;

export async function processTelegramOutbox(limit = 20): Promise<number> {
  const config = getTelegramConfig();
  if (!config || processing) return 0;
  processing = true;
  let sent = 0;
  try {
    const rows = getDb().prepare(
      `SELECT id, method, payload_json, metadata_json, attempts
       FROM telegram_outbox
       WHERE status = 'pending' AND next_attempt_at <= ?
       ORDER BY id ASC LIMIT ?`,
    ).all(Date.now(), Math.min(Math.max(Math.floor(limit), 1), 100)) as Array<{
      id: number;
      method: string;
      payload_json: string;
      metadata_json: string;
      attempts: number;
    }>;
    for (const row of rows) {
      try {
        const response = await fetch(`https://api.telegram.org/bot${config.botToken}/${row.method}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: row.payload_json,
          signal: AbortSignal.timeout(8_000),
        });
        const result = await response.json() as TelegramApiResponse;
        if (!response.ok || !result.ok) throw new Error(result.description || `HTTP ${response.status}`);
        getDb().prepare(
          `UPDATE telegram_outbox
           SET status = 'sent', attempts = attempts + 1, last_error = '', sent_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        ).run(row.id);
        const metadata = JSON.parse(row.metadata_json || "{}") as TelegramMetadata;
        const chatId = result.result?.chat?.id;
        const messageId = result.result?.message_id;
        if (metadata.stationThreadId && chatId != null && messageId) {
          getDb().prepare(
            `INSERT OR REPLACE INTO telegram_message_links (
               chat_id, message_id, station_thread_id, station_message_id
             ) VALUES (?, ?, ?, ?)`,
          ).run(String(chatId), messageId, metadata.stationThreadId, metadata.stationMessageId || null);
        }
        sent += 1;
      } catch (error) {
        const attempts = row.attempts + 1;
        const final = attempts >= 8;
        const delay = Math.min(15 * 60_000, 5_000 * (2 ** Math.min(attempts, 8)));
        getDb().prepare(
          `UPDATE telegram_outbox
           SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?
           WHERE id = ?`,
        ).run(
          final ? "failed" : "pending",
          attempts,
          Date.now() + delay,
          (error instanceof Error ? error.message : "Telegram 请求失败").slice(0, 500),
          row.id,
        );
      }
    }
    return sent;
  } finally {
    processing = false;
  }
}
