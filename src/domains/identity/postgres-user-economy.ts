import crypto from "node:crypto";
import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";

export type PostgresCurrency = "soda" | "cookie";
export type PostgresCurrencyTransaction = Readonly<{
  id: number;
  currency: PostgresCurrency;
  amount: number;
  balanceAfter: number;
  source: string;
  note: string;
  createdAt: string;
}>;
export type PostgresCurrencyTransactionPage = Readonly<{
  items: PostgresCurrencyTransaction[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;
export type PostgresDailyCheckinLeaderboardEntry = Readonly<{
  userId: number;
  displayName: string;
  avatarPath: string | null;
  reward: number;
}>;
export type PostgresDailyCheckinResult =
  | Readonly<{ ok: true; reward: number; balance: number; alreadyCheckedIn: boolean }>
  | Readonly<{ ok: false }>;

type RandomInt = (maxExclusive: number) => number;
type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type CheckinRow = QueryResultRow & { reward: string | number };
type UserBalanceRow = QueryResultRow & {
  status: string;
  soda_balance: string | number;
  soda_experience: string | number;
  cookie_balance: string | number;
};
type PageRow = QueryResultRow & {
  total_items: string | number;
  total_pages: string | number;
  page: string | number;
  id: string | number | null;
  currency: string | null;
  amount: string | number | null;
  balance_after: string | number | null;
  source: string | null;
  note: string | null;
  created_at: Date | string | null;
};

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function safeInteger(value: string | number | null | undefined, label: string): number {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null): string {
  const date = value instanceof Date ? value : new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid PostgreSQL currency transaction timestamp");
  return date.toISOString();
}

export function postgresSiteDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function drawPostgresDailySoda(randomInt: RandomInt = crypto.randomInt): number {
  return randomInt(100) < 95 ? 1 + randomInt(8) : 9 + randomInt(12);
}

export async function getPostgresDailyCheckinState(
  executor: SqlExecutor,
  userIdValue: number,
  now = new Date(),
): Promise<{ checkedIn: boolean; reward: number }> {
  const result = await executor.query<CheckinRow>({
    name: "identity-checkin-state-v1",
    text: "SELECT reward FROM user_checkins WHERE user_id = $1 AND checkin_date = $2::date",
    values: [positiveId(userIdValue, "user id"), postgresSiteDateKey(now)],
  });
  return { checkedIn: Boolean(result.rows[0]), reward: safeInteger(result.rows[0]?.reward, "checkin reward") };
}

export async function listPostgresDailyCheckinLeaderboard(
  executor: SqlExecutor,
  now = new Date(),
  limit = 50,
): Promise<PostgresDailyCheckinLeaderboardEntry[]> {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 100) : 50;
  const result = await executor.query<QueryResultRow & {
    user_id: string | number; display_name: string; avatar_path: string | null; reward: string | number;
  }>({
    name: "identity-checkin-leaderboard-v1",
    text: `SELECT checkin.user_id, account.display_name, account.avatar_path, checkin.reward
      FROM user_checkins checkin JOIN users account ON account.id = checkin.user_id
      WHERE checkin.checkin_date = $1::date AND account.status = 'active' AND account.deleted_at IS NULL
      ORDER BY checkin.reward DESC, checkin.created_at ASC, checkin.user_id ASC LIMIT $2`,
    values: [postgresSiteDateKey(now), safeLimit],
  });
  return result.rows.map((row) => ({
    userId: positiveId(Number(row.user_id), "leaderboard user id"),
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    reward: safeInteger(row.reward, "leaderboard reward"),
  }));
}

export async function claimPostgresDailySoda(
  userIdValue: number,
  now = new Date(),
  randomInt: RandomInt = crypto.randomInt,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresDailyCheckinResult> {
  const userId = positiveId(userIdValue, "user id");
  const date = postgresSiteDateKey(now);
  return transaction(async (tx) => {
    const users = await tx.query<UserBalanceRow>({
      text: `SELECT status, soda_balance, soda_experience, cookie_balance FROM users
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      values: [userId],
    });
    const user = users.rows[0];
    if (!user || user.status !== "active") return { ok: false };
    const existing = await tx.query<CheckinRow>({
      text: "SELECT reward FROM user_checkins WHERE user_id = $1 AND checkin_date = $2::date",
      values: [userId, date],
    });
    const currentBalance = safeInteger(user.soda_balance, "soda balance");
    if (existing.rows[0]) {
      return { ok: true, reward: safeInteger(existing.rows[0].reward, "checkin reward"), balance: currentBalance, alreadyCheckedIn: true };
    }
    const reward = drawPostgresDailySoda(randomInt);
    const inserted = await tx.query({
      text: `INSERT INTO user_checkins (user_id, checkin_date, reward)
        VALUES ($1, $2::date, $3) ON CONFLICT (user_id, checkin_date) DO NOTHING`,
      values: [userId, date, reward],
    });
    if (inserted.rowCount !== 1) {
      const concurrent = await tx.query<CheckinRow>({
        text: "SELECT reward FROM user_checkins WHERE user_id = $1 AND checkin_date = $2::date",
        values: [userId, date],
      });
      return { ok: true, reward: safeInteger(concurrent.rows[0]?.reward, "checkin reward"), balance: currentBalance, alreadyCheckedIn: true };
    }
    const updated = await tx.query<QueryResultRow & { soda_balance: string | number }>({
      text: `UPDATE users SET
          soda_balance = soda_balance + $2,
          soda_experience = soda_experience + $2,
          trust_level = COALESCE((SELECT MAX(level) FROM user_levels WHERE soda_required <= users.soda_experience + $2), 1),
          updated_at = clock_timestamp()
        WHERE id = $1 RETURNING soda_balance`,
      values: [userId, reward],
    });
    const balance = safeInteger(updated.rows[0]?.soda_balance, "updated soda balance");
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note)
        VALUES ($1, 'soda', $2, $3, 'daily_checkin', $4, '每日签到')`,
      values: [userId, reward, balance, `daily-checkin:${userId}:${date}`],
    });
    return { ok: true, reward, balance, alreadyCheckedIn: false };
  });
}

export async function listPostgresCurrencyTransactionsPage(
  executor: SqlExecutor,
  userIdValue: number,
  requestedPage = 1,
  requestedPageSize = 10,
  currency?: PostgresCurrency,
): Promise<PostgresCurrencyTransactionPage> {
  const userId = positiveId(userIdValue, "user id");
  const pageSize = Number.isFinite(requestedPageSize) ? Math.min(Math.max(Math.floor(requestedPageSize), 1), 100) : 10;
  const requested = Number.isFinite(requestedPage) ? Math.max(Math.floor(requestedPage), 1) : 1;
  const result = await executor.query<PageRow>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items,
               GREATEST(CEIL(COUNT(*)::numeric / $4::integer), 1)::bigint AS total_pages
        FROM user_currency_transactions WHERE user_id = $1 AND ($2::text IS NULL OR currency = $2)
      ), requested AS (
        SELECT total_items, total_pages, LEAST($3::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.total_items, requested.total_pages, requested.page,
             item.id, item.currency, item.amount, item.balance_after, item.source, item.note, item.created_at
      FROM requested LEFT JOIN LATERAL (
        SELECT id, currency, amount, balance_after, source, note, created_at
        FROM user_currency_transactions
        WHERE user_id = $1 AND ($2::text IS NULL OR currency = $2)
        ORDER BY id DESC LIMIT $4 OFFSET ((requested.page - 1) * $4)
      ) item ON TRUE`,
    values: [userId, currency ?? null, requested, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL currency page metadata is missing");
  const items = result.rows.flatMap((row): PostgresCurrencyTransaction[] => {
    if (row.id === null) return [];
    if ((row.currency !== "soda" && row.currency !== "cookie") || row.amount === null || row.balance_after === null ||
        row.source === null || row.note === null || row.created_at === null) throw new Error("Invalid PostgreSQL currency transaction");
    return [{
      id: positiveId(Number(row.id), "currency transaction id"), currency: row.currency,
      amount: safeInteger(row.amount, "currency amount"), balanceAfter: safeInteger(row.balance_after, "currency balance"),
      source: row.source, note: row.note, createdAt: timestamp(row.created_at),
    }];
  });
  return {
    items,
    page: safeInteger(first.page, "currency page"), pageSize,
    totalItems: safeInteger(first.total_items, "currency total"),
    totalPages: safeInteger(first.total_pages, "currency total pages"),
  };
}

export async function updatePostgresUserGrowth(
  input: { userId: number; sodaBalance: number; sodaExperience: number; cookieBalance?: number; adminName: string },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<boolean> {
  const userId = positiveId(input.userId, "user id");
  const sodaBalance = Math.min(Math.max(Math.floor(input.sodaBalance), 0), 2_000_000_000);
  const sodaExperience = Math.min(Math.max(Math.floor(input.sodaExperience), sodaBalance), 2_000_000_000);
  const requestedCookieBalance = input.cookieBalance == null ? null : Math.min(Math.max(Math.floor(input.cookieBalance), 0), 2_000_000_000);
  const adminName = Array.from(input.adminName.trim()).slice(0, 40).join("");
  return transaction(async (tx) => {
    const users = await tx.query<UserBalanceRow>({
      text: "SELECT status, soda_balance, soda_experience, cookie_balance FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
      values: [userId],
    });
    const current = users.rows[0];
    if (!current) return false;
    const oldSoda = safeInteger(current.soda_balance, "current soda balance");
    const oldCookie = safeInteger(current.cookie_balance, "current cookie balance");
    const cookieBalance = requestedCookieBalance ?? oldCookie;
    await tx.query({
      text: `UPDATE users SET trust_level = COALESCE((SELECT MAX(level) FROM user_levels WHERE soda_required <= $3), 1),
        soda_balance = $2, soda_experience = $3, cookie_balance = $4, updated_at = clock_timestamp() WHERE id = $1`,
      values: [userId, sodaBalance, sodaExperience, cookieBalance],
    });
    if (sodaBalance !== oldSoda) {
      await tx.query({
        text: `INSERT INTO user_currency_transactions (user_id, currency, amount, balance_after, source, note)
          VALUES ($1, 'soda', $2, $3, 'admin_adjustment', $4)`,
        values: [userId, sodaBalance - oldSoda, sodaBalance, `由 ${adminName} 调整`],
      });
    }
    if (cookieBalance !== oldCookie) {
      await tx.query({
        text: `INSERT INTO user_currency_transactions (user_id, currency, amount, balance_after, source, note)
          VALUES ($1, 'cookie', $2, $3, 'admin_adjustment', $4)`,
        values: [userId, cookieBalance - oldCookie, cookieBalance, `由 ${adminName} 调整`],
      });
    }
    return true;
  });
}
