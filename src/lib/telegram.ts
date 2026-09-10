import crypto from "node:crypto";
import { database } from "@/core/db/postgres";
import { processPostgresTelegramOutbox } from "@/domains/notifications/postgres-telegram-outbox";
import { getTelegramConfig } from "./telegram-config";

type TelegramRuntimeGlobal = typeof globalThis & {
  novelReaderTelegramStarted?: boolean;
};

async function ensureTelegramWebhook() {
  const config = getTelegramConfig();
  if (!config?.webhookUrl || !config.webhookSecret) return;
  const fingerprint = crypto.createHash("sha256")
    .update(`${config.botToken}\n${config.webhookUrl}\n${config.webhookSecret}`)
    .digest("hex");
  const key = "telegram_webhook_fingerprint";
  const current = await database("jobs").query<{ value: string }>({
    text: "SELECT value FROM app_metadata WHERE key = $1",
    values: [key],
  });
  if (current.rows[0]?.value === fingerprint) return;
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
    body: JSON.stringify({
      url: config.webhookUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ["message"],
      drop_pending_updates: false,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json() as { ok?: boolean; description?: string };
  if (!response.ok || !body.ok) throw new Error(body.description || `HTTP ${response.status}`);
  await database("jobs").query({
    text: `INSERT INTO app_metadata (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = clock_timestamp()`,
    values: [key, fingerprint],
  });
}

export async function initializeTelegramIntegration() {
  if (!getTelegramConfig()) return;
  const globalState = globalThis as TelegramRuntimeGlobal;
  if (globalState.novelReaderTelegramStarted) return;
  globalState.novelReaderTelegramStarted = true;

  void ensureTelegramWebhook().catch((error) => {
    console.warn("[telegram] webhook setup failed", error);
  });
  void processPostgresTelegramOutbox().catch((error) => {
    console.warn("[telegram] outbox delivery failed", error);
  });
  const timer = setInterval(() => {
    void processPostgresTelegramOutbox().catch((error) => {
      console.warn("[telegram] outbox delivery failed", error);
    });
  }, 10_000);
  timer.unref();
}
