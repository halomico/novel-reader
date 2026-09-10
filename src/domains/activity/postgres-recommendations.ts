import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";

export type PostgresRecommendationState = Readonly<{ recommended: boolean; count: number; sodaBalance: number }>;
export type PostgresRecommendationResult =
  | ({ ok: true; alreadyRecommended: boolean } & PostgresRecommendationState)
  | { ok: false; reason: "invalid" | "insufficient_soda" };

type TransactionRunner = <T>(operation: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
type StateRow = QueryResultRow & { recommended: boolean; count: string | number; soda_balance: string | number };
type AccountRow = QueryResultRow & { status: string; soda_balance: string | number };
type ItemRow = QueryResultRow & { title: string; kind?: string; recommend_count: string | number };

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function count(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function recommendationCost(value: number): number {
  if (!Number.isSafeInteger(value)) throw new TypeError("Invalid PostgreSQL recommendation cost");
  return Math.min(Math.max(value, 1), 100);
}

async function getState(executor: SqlExecutor, userIdValue: number, itemIdValue: number, kind: "novel" | "media"): Promise<PostgresRecommendationState> {
  const userId = positiveId(userIdValue, "user id");
  const itemId = positiveId(itemIdValue, `${kind} id`);
  const itemTable = kind === "novel" ? "novels" : "media_assets";
  const relationTable = kind === "novel" ? "novel_recommendations" : "media_recommendations";
  const relationColumn = kind === "novel" ? "novel_id" : "media_id";
  const condition = kind === "media" ? "AND item.kind IN ('video', 'audio')" : "";
  const result = await executor.query<StateRow>({
    text: `SELECT item.recommend_count AS count, account.soda_balance,
      EXISTS (SELECT 1 FROM ${relationTable} relation
        WHERE relation.user_id = account.id AND relation.${relationColumn} = item.id) AS recommended
      FROM users account CROSS JOIN ${itemTable} item
      WHERE account.id = $1 AND account.deleted_at IS NULL AND item.id = $2 ${condition}`,
    values: [userId, itemId],
  });
  const row = result.rows[0];
  return row ? { recommended: row.recommended === true, count: count(row.count, "recommendation count"), sodaBalance: count(row.soda_balance, "soda balance") }
    : { recommended: false, count: 0, sodaBalance: 0 };
}

export function getPostgresMediaRecommendationState(executor: SqlExecutor, userId: number, mediaId: number) {
  return getState(executor, userId, mediaId, "media");
}

async function recommend(
  userIdValue: number,
  itemIdValue: number,
  kind: "novel" | "media",
  costValue: number,
  transaction: TransactionRunner,
): Promise<PostgresRecommendationResult> {
  const userId = positiveId(userIdValue, "user id");
  const itemId = positiveId(itemIdValue, `${kind} id`);
  const cost = recommendationCost(costValue);
  const itemTable = kind === "novel" ? "novels" : "media_assets";
  const relationTable = kind === "novel" ? "novel_recommendations" : "media_recommendations";
  const relationColumn = kind === "novel" ? "novel_id" : "media_id";
  const condition = kind === "media" ? "AND kind IN ('video', 'audio')" : "";
  return transaction(async (tx) => {
    const accounts = await tx.query<AccountRow>({
      text: "SELECT status, soda_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      values: [userId],
    });
    const account = accounts.rows[0];
    if (!account || account.status !== "active") return { ok: false, reason: "invalid" };
    const items = await tx.query<ItemRow>({
      text: `SELECT title, ${kind === "media" ? "kind, " : ""}recommend_count FROM ${itemTable} WHERE id = $1 ${condition} FOR UPDATE`,
      values: [itemId],
    });
    const item = items.rows[0];
    if (!item) return { ok: false, reason: "invalid" };
    const balance = count(account.soda_balance, "soda balance");
    const currentCount = count(item.recommend_count, "recommendation count");
    const existing = await tx.query({
      text: `SELECT 1 FROM ${relationTable} WHERE user_id = $1 AND ${relationColumn} = $2`,
      values: [userId, itemId],
    });
    if (existing.rowCount) return { ok: true, alreadyRecommended: true, recommended: true, count: currentCount, sodaBalance: balance };
    if (balance < cost) return { ok: false, reason: "insufficient_soda" };
    const nextBalance = balance - cost;
    await tx.query({ text: "UPDATE users SET soda_balance = $2, updated_at = clock_timestamp() WHERE id = $1", values: [userId, nextBalance] });
    const inserted = await tx.query({
      text: `INSERT INTO ${relationTable} (${relationColumn}, user_id, soda_spent) VALUES ($1, $2, $3) ON CONFLICT (${relationColumn}, user_id) DO NOTHING`,
      values: [itemId, userId, cost],
    });
    if (inserted.rowCount !== 1) throw new Error("PostgreSQL recommendation conflict after locked existence check");
    await tx.query({ text: `UPDATE ${itemTable} SET recommend_count = recommend_count + 1, updated_at = clock_timestamp() WHERE id = $1`, values: [itemId] });
    const noun = kind === "novel" ? "小说" : item.kind === "audio" ? "音频" : "视频";
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note)
        VALUES ($1, 'soda', $2, $3, $4, $5, $6)`,
      values: [userId, -cost, nextBalance, `${kind}_recommendation`, `${kind}-recommendation:${userId}:${itemId}`, `推荐${noun}「${Array.from(item.title).slice(0, 80).join("")}」`],
    });
    return { ok: true, alreadyRecommended: false, recommended: true, count: currentCount + 1, sodaBalance: nextBalance };
  });
}

export function recommendPostgresNovelWithSoda(userId: number, novelId: number, cost = 1, transaction: TransactionRunner = (operation) => withTransaction(operation)) {
  return recommend(userId, novelId, "novel", cost, transaction);
}

export function recommendPostgresMediaWithSoda(userId: number, mediaId: number, cost = 1, transaction: TransactionRunner = (operation) => withTransaction(operation)) {
  return recommend(userId, mediaId, "media", cost, transaction);
}

export async function getPostgresNovelRecommendationCount(executor: SqlExecutor, novelIdValue: number): Promise<number> {
  const result = await executor.query<QueryResultRow & { recommend_count: string | number }>({
    text: "SELECT recommend_count FROM novels WHERE id = $1",
    values: [positiveId(novelIdValue, "novel id")],
  });
  return result.rows[0] ? count(result.rows[0].recommend_count, "recommendation count") : 0;
}

export async function setPostgresNovelRecommendationCount(executor: SqlExecutor, novelIdValue: number, value: number): Promise<boolean> {
  const normalized = Math.min(Math.max(Math.floor(value), 0), 2_000_000_000);
  const result = await executor.query({
    text: "UPDATE novels SET recommend_count = $2, updated_at = clock_timestamp() WHERE id = $1",
    values: [positiveId(novelIdValue, "novel id"), normalized],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function countPostgresRecommendationPoolNovels(executor: SqlExecutor): Promise<number> {
  const result = await executor.query<QueryResultRow & { total: string | number }>({
    name: "activity-recommendation-pool-count-v1",
    text: "SELECT count(*)::bigint AS total FROM novel_recommendation_pool",
  });
  return count(result.rows[0]?.total ?? 0, "recommendation pool count");
}
