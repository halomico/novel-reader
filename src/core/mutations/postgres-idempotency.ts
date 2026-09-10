import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { MutationIdError, type MutationReceiptContract } from "./mutation-contract";

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type ReceiptRow = QueryResultRow & {
  user_id: string | number | null;
  operation: string;
  target_key: string;
  payload_hash: string;
  result_json: unknown;
};

function receiptUserId(value: ReceiptRow["user_id"]): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new MutationIdError("操作回执损坏，请联系管理员");
  return parsed;
}

function receiptResult<T>(value: unknown): T {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      throw new MutationIdError("操作回执损坏，请联系管理员");
    }
  }
  if (value === undefined) throw new MutationIdError("操作回执损坏，请联系管理员");
  return value as T;
}

export async function runPostgresIdempotentMutation<T>(
  contract: MutationReceiptContract,
  execute: (transaction: SqlExecutor) => Promise<T>,
  transaction: TransactionRunner = (operation) => withTransaction(operation, { isolation: "serializable" }),
): Promise<T> {
  return transaction(async (tx) => {
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended('mutation:' || $1, 0))",
      values: [contract.mutationId],
    });
    const existing = await tx.query<ReceiptRow>({
      text: `SELECT user_id, operation, target_key, payload_hash, result_json
        FROM mutation_receipts WHERE mutation_id = $1`,
      values: [contract.mutationId],
    });
    const row = existing.rows[0];
    if (row) {
      if (
        receiptUserId(row.user_id) !== contract.userId || row.operation !== contract.operation ||
        row.target_key !== contract.target || row.payload_hash !== contract.payloadHash
      ) {
        throw new MutationIdError("操作标识已用于其他请求，请刷新页面后重试");
      }
      return receiptResult<T>(row.result_json);
    }
    const result = await execute(tx);
    await tx.query({
      text: `INSERT INTO mutation_receipts (
        mutation_id, user_id, operation, target_key, payload_hash, result_json, created_at)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, clock_timestamp())`,
      values: [
        contract.mutationId,
        contract.userId,
        contract.operation,
        contract.target,
        contract.payloadHash,
        JSON.stringify(result),
      ],
    });
    return result;
  });
}
