import { NextRequest, NextResponse } from "next/server";
import { database } from "@/core/db/postgres";
import { readJsonBody } from "@/core/security/request-body";
import { addPostgresStationReply, createPostgresStationThread, getPostgresStationThread } from "@/domains/station/postgres-station";
import { getTelegramConfig } from "@/lib/telegram-config";
import {
  bindPostgresTelegramLinkToken,
  claimPostgresTelegramUpdate,
  getPostgresStationThreadForTelegramReply,
  getPostgresTelegramLinkedUserId,
  releasePostgresTelegramUpdate,
} from "@/domains/notifications/postgres-telegram-links";
import { processPostgresTelegramOutbox, queuePostgresTelegramText } from "@/domains/notifications/postgres-telegram-outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number; username?: string; is_bot?: boolean };
    reply_to_message?: { message_id?: number };
  };
};

function flushTelegramOutbox() {
  void processPostgresTelegramOutbox().catch((error) => {
    console.warn("[telegram] immediate delivery failed", error);
  });
}

export async function POST(request: NextRequest) {
  const config = getTelegramConfig();
  if (!config?.webhookSecret || request.headers.get("x-telegram-bot-api-secret-token") !== config.webhookSecret) {
    return new NextResponse(null, { status: 404 });
  }
  const parsed = await readJsonBody<TelegramUpdate>(request, 256 * 1024);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false }, { status: parsed.reason === "too_large" ? 413 : 400 });
  }
  const update = parsed.value;
  const updateId = Number(update.update_id);
  if (!Number.isSafeInteger(updateId) || updateId < 1 || !await claimPostgresTelegramUpdate(database("web"), updateId)) {
    return NextResponse.json({ ok: true });
  }

  try {
    const message = update.message;
    const chatId = message?.chat?.id == null ? "" : String(message.chat.id);
    const senderId = Number(message?.from?.id || 0);
    const text = String(message?.text || "").trim();
    if (!chatId || !text || message?.from?.is_bot) return NextResponse.json({ ok: true });

    const linkToken = /^\/start\s+link_([A-Za-z0-9_-]{32,80})$/.exec(text)?.[1];
    if (linkToken) {
      const linked = await bindPostgresTelegramLinkToken({
        token: linkToken,
        chatId,
        username: message?.from?.username,
      });
      await queuePostgresTelegramText(database("web"), chatId, linked.ok ? "账号已连接，站务回复会同步到这里。" : "连接链接已失效，请回到网站重新获取。");
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }

    const replyMessageId = Number(message?.reply_to_message?.message_id || 0);
    const threadId = replyMessageId > 0
      ? await getPostgresStationThreadForTelegramReply(database("web"), chatId, replyMessageId)
      : null;
    if (threadId && config.adminUserIds.has(senderId)) {
      await addPostgresStationReply({ threadId, body: text, authorRole: "admin" });
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }

    const userId = await getPostgresTelegramLinkedUserId(database("web"), chatId);
    if (userId && threadId && await getPostgresStationThread(database("web"), threadId, { userId })) {
      await addPostgresStationReply({ threadId, body: text, authorRole: "user", userId });
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }
    if (userId) {
      await createPostgresStationThread(userId, "Telegram 留言", text);
      await queuePostgresTelegramText(database("web"), chatId, "留言已送达。收到回复时会在这里通知你。", {
        dedupeKey: `telegram-user-ack:${updateId}`,
      });
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }

    await queuePostgresTelegramText(database("web"), chatId, "请先在网站的消息页连接 Telegram。", {
      dedupeKey: `telegram-unlinked:${updateId}`,
    });
    flushTelegramOutbox();
    return NextResponse.json({ ok: true });
  } catch (error) {
    await releasePostgresTelegramUpdate(database("web"), updateId);
    console.error("[telegram] webhook processing failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
