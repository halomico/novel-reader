import { NextRequest, NextResponse } from "next/server";
import { addStationReply, createStationThread, getStationThread } from "@/lib/station";
import { getTelegramConfig } from "@/lib/telegram-config";
import {
  bindTelegramLinkToken,
  claimTelegramUpdate,
  getStationThreadForTelegramReply,
  getTelegramLinkedUserId,
  releaseTelegramUpdate,
} from "@/lib/telegram-links";
import { processTelegramOutbox, queueTelegramText } from "@/lib/telegram-outbox";

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
  void processTelegramOutbox().catch((error) => {
    console.warn("[telegram] immediate delivery failed", error);
  });
}

export async function POST(request: NextRequest) {
  const config = getTelegramConfig();
  if (!config?.webhookSecret || request.headers.get("x-telegram-bot-api-secret-token") !== config.webhookSecret) {
    return new NextResponse(null, { status: 404 });
  }
  let update: TelegramUpdate;
  try {
    update = await request.json() as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const updateId = Number(update.update_id);
  if (!Number.isSafeInteger(updateId) || !claimTelegramUpdate(updateId)) {
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
      const linked = bindTelegramLinkToken({
        token: linkToken,
        chatId,
        username: message?.from?.username,
      });
      queueTelegramText(chatId, linked.ok ? "账号已连接，站务回复会同步到这里。" : "连接链接已失效，请回到网站重新获取。");
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }

    const replyMessageId = Number(message?.reply_to_message?.message_id || 0);
    const threadId = replyMessageId > 0 ? getStationThreadForTelegramReply(chatId, replyMessageId) : null;
    if (threadId && config.adminUserIds.has(senderId)) {
      addStationReply({ threadId, body: text, authorRole: "admin" });
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }

    const userId = getTelegramLinkedUserId(chatId);
    if (userId && threadId && getStationThread(threadId, { userId })) {
      addStationReply({ threadId, body: text, authorRole: "user", userId });
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }
    if (userId) {
      createStationThread(userId, "Telegram 留言", text);
      queueTelegramText(chatId, "留言已送达。收到回复时会在这里通知你。", {
        dedupeKey: `telegram-user-ack:${updateId}`,
      });
      flushTelegramOutbox();
      return NextResponse.json({ ok: true });
    }

    queueTelegramText(chatId, "请先在网站的消息页连接 Telegram。", {
      dedupeKey: `telegram-unlinked:${updateId}`,
    });
    flushTelegramOutbox();
    return NextResponse.json({ ok: true });
  } catch (error) {
    releaseTelegramUpdate(updateId);
    console.error("[telegram] webhook processing failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
