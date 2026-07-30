import crypto from "node:crypto";
import { getDb } from "./db";
import { getUserLevelForExperience } from "./user-levels";

export type UserCurrency = "soda" | "cookie";

export type CurrencyTransaction = {
  id: number;
  currency: UserCurrency;
  amount: number;
  balanceAfter: number;
  source: string;
  note: string;
  createdAt: string;
};

type CurrencyTransactionRow = {
  id: number;
  currency: UserCurrency;
  amount: number;
  balance_after: number;
  source: string;
  note: string;
  created_at: string;
};

function balanceColumn(currency: UserCurrency): "soda_balance" | "cookie_balance" {
  return currency === "soda" ? "soda_balance" : "cookie_balance";
}

export function recordCurrencyTransaction(input: {
  userId: number;
  currency: UserCurrency;
  amount: number;
  balanceAfter: number;
  source: string;
  referenceKey?: string | null;
  note?: string;
}) {
  getDb()
    .prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.currency,
      Math.trunc(input.amount),
      Math.max(Math.trunc(input.balanceAfter), 0),
      input.source.slice(0, 80),
      input.referenceKey || null,
      (input.note || "").slice(0, 240),
    );
}

export function adjustUserCurrency(input: {
  userId: number;
  currency: UserCurrency;
  amount: number;
  source: string;
  referenceKey?: string | null;
  note?: string;
}): number {
  const amount = Math.trunc(input.amount);
  if (!amount) {
    throw new Error("余额变动不能为零");
  }
  const column = balanceColumn(input.currency);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(`SELECT status, ${column} AS balance FROM users WHERE id = ?`)
      .get(input.userId) as { status: string; balance: number } | undefined;
    if (!row || row.status === "disabled") {
      throw new Error("用户不可用");
    }
    const balance = Math.trunc(row.balance || 0) + amount;
    if (balance < 0) {
      throw new Error(input.currency === "cookie" ? "曲奇不足" : "苏打不足");
    }
    db.prepare(`UPDATE users SET ${column} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(balance, input.userId);
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.userId,
      input.currency,
      amount,
      balance,
      input.source.slice(0, 80),
      input.referenceKey || null,
      (input.note || "").slice(0, 240),
    );
    db.exec("COMMIT");
    return balance;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function exchangeCookieForSoda(input: {
  userId: number;
  cookieAmount: number;
  sodaPerCookie: number;
}): { cookieBalance: number; sodaBalance: number; sodaReceived: number } {
  const cookieAmount = Math.min(Math.max(Math.floor(input.cookieAmount), 1), 1_000_000);
  const sodaPerCookie = Math.min(Math.max(Math.floor(input.sodaPerCookie), 1), 10_000);
  const sodaReceived = cookieAmount * sodaPerCookie;
  if (!Number.isSafeInteger(sodaReceived) || sodaReceived > 2_000_000_000) {
    throw new Error("兑换数量过大");
  }
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const user = db
      .prepare(
        `SELECT status, cookie_balance, soda_balance, soda_experience
         FROM users WHERE id = ?`,
      )
      .get(input.userId) as {
      status: string;
      cookie_balance: number;
      soda_balance: number;
      soda_experience: number;
    } | undefined;
    if (!user || user.status !== "active") throw new Error("用户不可用");
    if (user.cookie_balance < cookieAmount) throw new Error("曲奇不足");
    const cookieBalance = user.cookie_balance - cookieAmount;
    const sodaBalance = user.soda_balance + sodaReceived;
    const sodaExperience = user.soda_experience + sodaReceived;
    if (sodaBalance > 2_000_000_000 || sodaExperience > 2_000_000_000) {
      throw new Error("苏打余额已达上限");
    }
    const trustLevel = getUserLevelForExperience(sodaExperience);
    db.prepare(
      `UPDATE users
       SET cookie_balance = ?, soda_balance = ?, soda_experience = ?,
           trust_level = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(cookieBalance, sodaBalance, sodaExperience, trustLevel, input.userId);
    const reference = `currency-exchange:${input.userId}:${crypto.randomUUID()}`;
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       )
       VALUES (?, 'cookie', ?, ?, 'currency_exchange', ?, ?)`,
    ).run(
      input.userId,
      -cookieAmount,
      cookieBalance,
      `${reference}:cookie`,
      `兑换 ${sodaReceived} 苏打`,
    );
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       )
       VALUES (?, 'soda', ?, ?, 'currency_exchange', ?, ?)`,
    ).run(
      input.userId,
      sodaReceived,
      sodaBalance,
      `${reference}:soda`,
      `由 ${cookieAmount} 曲奇兑换`,
    );
    db.exec("COMMIT");
    return { cookieBalance, sodaBalance, sodaReceived };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listCurrencyTransactions(
  userId: number,
  options: { currency?: UserCurrency; limit?: number } = {},
): CurrencyTransaction[] {
  const limit = Math.min(Math.max(Math.floor(options.limit || 50), 1), 200);
  const rows = (options.currency
    ? getDb()
        .prepare(
          `SELECT id, currency, amount, balance_after, source, note, created_at
           FROM user_currency_transactions
           WHERE user_id = ? AND currency = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .all(userId, options.currency, limit)
    : getDb()
        .prepare(
          `SELECT id, currency, amount, balance_after, source, note, created_at
           FROM user_currency_transactions
           WHERE user_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`,
        )
        .all(userId, limit)) as CurrencyTransactionRow[];
  return rows.map((row) => ({
    id: row.id,
    currency: row.currency,
    amount: row.amount,
    balanceAfter: row.balance_after,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
  }));
}
