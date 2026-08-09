export type TelegramConfig = {
  botToken: string;
  botUsername: string | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
  adminChatIds: string[];
  adminUserIds: Set<number>;
  announcementChatId: string | null;
};

let cached: { key: string; value: TelegramConfig | null } | null = null;

function numericIds(value: string | undefined): string[] {
  return [...new Set(String(value || "").split(",").map((item) => item.trim()).filter((item) => /^-?\d+$/.test(item)))];
}

function siteOrigin(value: string | undefined): string | null {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function getTelegramConfig(env: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const key = [
    env.TELEGRAM_BOT_TOKEN,
    env.TELEGRAM_BOT_USERNAME,
    env.TELEGRAM_WEBHOOK_SECRET,
    env.TELEGRAM_ADMIN_CHAT_IDS,
    env.TELEGRAM_ADMIN_USER_IDS,
    env.TELEGRAM_ANNOUNCEMENT_CHAT_ID,
    env.SITE_URL,
  ].join("\u0000");
  if (env === process.env && cached?.key === key) return cached.value;

  const botToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
    if (env === process.env) cached = { key, value: null };
    return null;
  }
  const rawUsername = String(env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");
  const botUsername = /^[A-Za-z0-9_]{5,32}$/.test(rawUsername) ? rawUsername : null;
  const rawSecret = String(env.TELEGRAM_WEBHOOK_SECRET || "").trim();
  const webhookSecret = /^[A-Za-z0-9_-]{16,256}$/.test(rawSecret) ? rawSecret : null;
  const origin = siteOrigin(env.SITE_URL);
  const adminUserIds = new Set(numericIds(env.TELEGRAM_ADMIN_USER_IDS).map(Number).filter(Number.isSafeInteger));
  const announcementChat = String(env.TELEGRAM_ANNOUNCEMENT_CHAT_ID || "").trim();
  const value: TelegramConfig = {
    botToken,
    botUsername,
    webhookSecret,
    webhookUrl: origin && webhookSecret ? `${origin}/api/telegram/webhook` : null,
    adminChatIds: numericIds(env.TELEGRAM_ADMIN_CHAT_IDS),
    adminUserIds,
    announcementChatId: /^-?\d+$|^@[A-Za-z0-9_]{5,32}$/.test(announcementChat) ? announcementChat : null,
  };
  if (env === process.env) cached = { key, value };
  return value;
}

export function isTelegramUserLinkAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = getTelegramConfig(env);
  return Boolean(config?.botUsername && config.webhookUrl);
}
