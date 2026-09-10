import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { database, withTransaction } from "@/core/db/postgres";

export type PostgresRegistrationInvite = Readonly<{
  id: number;
  hint: string;
  label: string;
  maxUses: number;
  usedCount: number;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
}>;

type InviteRow = QueryResultRow & {
  id: string | number;
  code_hint: string;
  label: string;
  max_uses: string | number;
  used_count: string | number;
  enabled: boolean;
  expires_at: Date | string | null;
  created_at: Date | string;
};

function inviteSecret(): string {
  const value = process.env.REGISTRATION_INVITE_SECRET
    || process.env.MARKET_SECRET_KEY
    || process.env.ADMIN_SESSION_SECRET
    || "";
  if (value.length < 32) throw new Error("请先配置 REGISTRATION_INVITE_SECRET");
  return value;
}

function normalizeCode(value: string): string {
  return value.trim().toLocaleUpperCase("en-US").replace(/\s+/gu, "");
}

function hashCode(value: string): string {
  return crypto.createHmac("sha256", inviteSecret()).update(normalizeCode(value)).digest("hex");
}

function generateCode(): string {
  const value = crypto.randomBytes(15).toString("base64url").toLocaleUpperCase("en-US").replace(/[-_]/gu, "X");
  return `JOIN-${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15, 20)}`;
}

function safeInteger(value: string | number, label: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return date.toISOString();
}

function normalizeExpiration(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new TypeError("邀请码有效期无效");
  if (date.getTime() <= Date.now()) throw new TypeError("邀请码有效期必须晚于当前时间");
  return date.toISOString();
}

export async function createPostgresRegistrationInvites(input: {
  label?: string;
  count: number;
  maxUses?: number;
  expiresAt?: string | null;
}): Promise<string[]> {
  const count = Math.min(Math.max(Math.floor(input.count), 1), 1_000);
  const maxUses = Math.min(Math.max(Math.floor(input.maxUses || 1), 1), 10_000);
  const label = (input.label || "").normalize("NFKC").trim().slice(0, 100);
  const expiresAt = normalizeExpiration(input.expiresAt);
  inviteSecret();

  return withTransaction(async (tx) => {
    const accepted: string[] = [];
    for (let attempt = 0; accepted.length < count && attempt < 5; attempt += 1) {
      const pending = new Map<string, string>();
      while (pending.size < count - accepted.length) {
        const code = generateCode();
        const codeHash = hashCode(code);
        pending.set(codeHash, code);
      }
      const inserted = await tx.query<{ code_hash: string }>({
        text: `WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb)
              AS value(code_hash text, code_hint text)
          ) INSERT INTO registration_invites (code_hash, code_hint, label, max_uses, expires_at)
          SELECT code_hash, code_hint, $2, $3, $4::timestamptz FROM input
          ON CONFLICT (code_hash) DO NOTHING
          RETURNING code_hash`,
        values: [
          JSON.stringify([...pending].map(([codeHash, code]) => ({ code_hash: codeHash, code_hint: code.slice(-6) }))),
          label,
          maxUses,
          expiresAt,
        ],
      });
      for (const row of inserted.rows) {
        const code = pending.get(row.code_hash);
        if (code) accepted.push(code);
      }
    }
    if (accepted.length !== count) throw new Error("邀请码生成冲突，请重试");
    return accepted;
  }, { isolation: "serializable", lockTimeoutMs: 2_000 });
}

export async function listPostgresRegistrationInvites(limit = 100): Promise<PostgresRegistrationInvite[]> {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 500);
  const result = await database("web").query<InviteRow>({
    name: "identity-registration-invites-list-v1",
    text: `SELECT id, code_hint, label, max_uses, used_count, enabled, expires_at, created_at
      FROM registration_invites ORDER BY created_at DESC, id DESC LIMIT $1`,
    values: [boundedLimit],
  });
  return result.rows.map((row) => ({
    id: safeInteger(row.id, "registration invite id", 1),
    hint: row.code_hint,
    label: row.label,
    maxUses: safeInteger(row.max_uses, "registration invite max uses", 1),
    usedCount: safeInteger(row.used_count, "registration invite used count", 0),
    enabled: row.enabled,
    expiresAt: timestamp(row.expires_at, "registration invite expiry"),
    createdAt: timestamp(row.created_at, "registration invite creation")!,
  }));
}
