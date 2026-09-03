import type { DatabaseSync } from "node:sqlite";

const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/u;

export class MutationIdError extends Error {}

export function normalizeMutationId(value: unknown): string {
  const mutationId = String(value || "").trim();
  if (!MUTATION_ID_PATTERN.test(mutationId)) {
    throw new MutationIdError("操作标识无效，请刷新页面后重试");
  }
  return mutationId;
}

export function readMutationReceipt<T>(
  db: DatabaseSync,
  mutationId: string,
  userId: number | null,
  operation: string,
): T | null {
  const row = db.prepare(
    `SELECT user_id, operation, result_json
     FROM mutation_receipts
     WHERE mutation_id = ?`,
  ).get(mutationId) as { user_id: number | null; operation: string; result_json: string } | undefined;
  if (!row) return null;
  if (row.user_id !== userId || row.operation !== operation) {
    throw new MutationIdError("操作标识已用于其他请求");
  }
  try {
    return JSON.parse(row.result_json) as T;
  } catch {
    throw new MutationIdError("操作回执损坏，请联系管理员");
  }
}

export function storeMutationReceipt<T>(
  db: DatabaseSync,
  mutationId: string,
  userId: number | null,
  operation: string,
  result: T,
  now = Date.now(),
): void {
  db.prepare(
    `INSERT INTO mutation_receipts (mutation_id, user_id, operation, result_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(mutationId, userId, operation, JSON.stringify(result), now);
}

export function pruneMutationReceipts(db: DatabaseSync, before: number): number {
  return Number(db.prepare("DELETE FROM mutation_receipts WHERE created_at < ?").run(before).changes);
}
