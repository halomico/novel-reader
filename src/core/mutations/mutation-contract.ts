import crypto from "node:crypto";

const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{16,100}$/u;
const MUTATION_TARGET_MAX_LENGTH = 500;

export class MutationIdError extends Error {}

export function normalizeMutationId(value: unknown): string {
  const mutationId = String(value || "").trim();
  if (!MUTATION_ID_PATTERN.test(mutationId)) {
    throw new MutationIdError("操作标识无效，请刷新页面后重试");
  }
  return mutationId;
}

export function normalizeMutationTarget(value: unknown): string {
  const target = String(value || "").normalize("NFKC").trim();
  if (!target) {
    throw new MutationIdError("操作目标无效，请刷新页面后重试");
  }
  if (target.length > MUTATION_TARGET_MAX_LENGTH) {
    throw new MutationIdError("操作目标过长，请刷新页面后重试");
  }
  return target;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value));
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en-US"));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function hashMutationPayload(value: unknown): string {
  return crypto.createHash("sha256").update(stableJson(value)).digest("hex");
}

export type MutationReceiptContract = {
  mutationId: string;
  userId: number | null;
  operation: string;
  target: string;
  payloadHash: string;
};
