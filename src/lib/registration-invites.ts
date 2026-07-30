import crypto from "node:crypto";
import { getDb } from "./db";

function secret(): string {
  const value =
    process.env.REGISTRATION_INVITE_SECRET ||
    process.env.MARKET_SECRET_KEY ||
    process.env.ADMIN_SESSION_SECRET ||
    "";
  if (value.length < 32) throw new Error("请先配置 REGISTRATION_INVITE_SECRET");
  return value;
}

function normalizeCode(value: string): string {
  return value.trim().toLocaleUpperCase("en-US").replace(/\s+/g, "");
}

function hashCode(value: string): string {
  return crypto.createHmac("sha256", secret()).update(normalizeCode(value)).digest("hex");
}

function generateCode(): string {
  const value = crypto.randomBytes(15).toString("base64url").toLocaleUpperCase("en-US").replace(/[-_]/g, "X");
  return `JOIN-${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15, 20)}`;
}

export function createRegistrationInvites(input: {
  label?: string;
  count: number;
  maxUses?: number;
  expiresAt?: string | null;
}): string[] {
  const count = Math.min(Math.max(Math.floor(input.count), 1), 1_000);
  const maxUses = Math.min(Math.max(Math.floor(input.maxUses || 1), 1), 10_000);
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO registration_invites (
       code_hash, code_hint, label, max_uses, expires_at
     )
     VALUES (?, ?, ?, ?, ?)`,
  );
  const codes: string[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    while (codes.length < count) {
      const code = generateCode();
      try {
        insert.run(
          hashCode(code),
          code.slice(-6),
          (input.label || "").trim().slice(0, 100),
          maxUses,
          input.expiresAt || null,
        );
        codes.push(code);
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
      }
    }
    db.exec("COMMIT");
    return codes;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function consumeRegistrationInviteInCurrentTransaction(codeValue: string): boolean {
  const code = normalizeCode(codeValue);
  if (code.length < 10) return false;
  const row = getDb()
    .prepare(
      `SELECT id
       FROM registration_invites
       WHERE code_hash = ? AND enabled = 1 AND used_count < max_uses
         AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
       LIMIT 1`,
    )
    .get(hashCode(code)) as { id: number } | undefined;
  if (!row) return false;
  return getDb()
    .prepare(
      `UPDATE registration_invites
       SET used_count = used_count + 1
       WHERE id = ? AND enabled = 1 AND used_count < max_uses`,
    )
    .run(row.id).changes > 0;
}

export function listRegistrationInvites(limit = 100): Array<{
  id: number;
  hint: string;
  label: string;
  maxUses: number;
  usedCount: number;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
}> {
  return (getDb()
    .prepare(
      `SELECT id, code_hint, label, max_uses, used_count, enabled, expires_at, created_at
       FROM registration_invites
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(Math.min(Math.max(Math.floor(limit), 1), 500)) as Array<{
    id: number;
    code_hint: string;
    label: string;
    max_uses: number;
    used_count: number;
    enabled: number;
    expires_at: string | null;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    hint: row.code_hint,
    label: row.label,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    enabled: row.enabled === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}
