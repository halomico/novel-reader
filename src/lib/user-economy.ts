import crypto from "node:crypto";
import { getDb } from "./db";
import { getUserLevelForExperience } from "./user-levels";

export type SodaTransaction = {
  id: number;
  amount: number;
  balanceAfter: number;
  source: string;
  note: string;
  createdAt: string;
};

export type SodaTransactionPage = {
  items: SodaTransaction[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type CurrencyTransaction = SodaTransaction & { currency: "soda" | "cookie" };
export type CurrencyTransactionPage = Omit<SodaTransactionPage, "items"> & { items: CurrencyTransaction[] };

export type DailyCheckinLeaderboardEntry = {
  userId: number;
  displayName: string;
  avatarPath: string | null;
  reward: number;
};

type RandomInt = (maxExclusive: number) => number;

export function getSiteDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function drawDailySoda(randomInt: RandomInt = crypto.randomInt): number {
  return randomInt(100) < 95 ? 1 + randomInt(8) : 9 + randomInt(12);
}

export function getDailyCheckinState(userId: number, now = new Date()): {
  checkedIn: boolean;
  reward: number;
} {
  const row = getDb()
    .prepare("SELECT reward FROM user_checkins WHERE user_id = ? AND checkin_date = ?")
    .get(userId, getSiteDateKey(now)) as { reward: number } | undefined;
  return { checkedIn: Boolean(row), reward: row?.reward || 0 };
}

export function listDailyCheckinLeaderboard(
  now = new Date(),
  limit = 50,
): DailyCheckinLeaderboardEntry[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  return (getDb()
    .prepare(
      `SELECT c.user_id, u.display_name, u.avatar_path, c.reward
       FROM user_checkins c
       JOIN users u ON u.id = c.user_id
       WHERE c.checkin_date = ? AND u.status = 'active'
       ORDER BY c.reward DESC, c.created_at ASC, c.user_id ASC
       LIMIT ?`,
    )
    .all(getSiteDateKey(now), safeLimit) as Array<{
    user_id: number;
    display_name: string;
    avatar_path: string | null;
    reward: number;
  }>).map((row) => ({
    userId: row.user_id,
    displayName: row.display_name,
    avatarPath: row.avatar_path,
    reward: row.reward,
  }));
}

export function claimDailySoda(
  userId: number,
  now = new Date(),
  randomInt: RandomInt = crypto.randomInt,
): { ok: true; reward: number; balance: number; alreadyCheckedIn: boolean } | { ok: false } {
  const db = getDb();
  const date = getSiteDateKey(now);
  db.exec("BEGIN IMMEDIATE");
  try {
    const user = db
      .prepare("SELECT status, soda_balance, soda_experience FROM users WHERE id = ?")
      .get(userId) as { status: string; soda_balance: number; soda_experience: number } | undefined;
    if (!user || user.status !== "active") {
      db.exec("ROLLBACK");
      return { ok: false };
    }
    const existing = db
      .prepare("SELECT reward FROM user_checkins WHERE user_id = ? AND checkin_date = ?")
      .get(userId, date) as { reward: number } | undefined;
    if (existing) {
      db.exec("COMMIT");
      return {
        ok: true,
        reward: existing.reward,
        balance: user.soda_balance,
        alreadyCheckedIn: true,
      };
    }

    const reward = drawDailySoda(randomInt);
    const balance = user.soda_balance + reward;
    const experience = user.soda_experience + reward;
    const trustLevel = getUserLevelForExperience(experience);
    db.prepare("INSERT INTO user_checkins (user_id, checkin_date, reward) VALUES (?, ?, ?)")
      .run(userId, date, reward);
    db.prepare(
      `UPDATE users
       SET soda_balance = ?, soda_experience = ?, trust_level = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(balance, experience, trustLevel, userId);
    db.prepare(
      `INSERT INTO user_currency_transactions (
         user_id, currency, amount, balance_after, source, reference_key, note
       )
       VALUES (?, 'soda', ?, ?, 'daily_checkin', ?, '每日签到')`,
    ).run(userId, reward, balance, `daily-checkin:${userId}:${date}`);
    db.exec("COMMIT");
    return { ok: true, reward, balance, alreadyCheckedIn: false };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listSodaTransactionsPage(
  userId: number,
  requestedPage = 1,
  requestedPageSize = 10,
): SodaTransactionPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(requestedPageSize || 10), 1), 100);
  const total = db.prepare(
    "SELECT COUNT(*) AS count FROM user_currency_transactions WHERE user_id = ? AND currency = 'soda'",
  ).get(userId) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = Math.min(Math.max(Math.floor(requestedPage || 1), 1), totalPages);
  const items = (db
    .prepare(
      `SELECT id, amount, balance_after, source, note, created_at
       FROM user_currency_transactions
       WHERE user_id = ? AND currency = 'soda'
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, pageSize, (page - 1) * pageSize) as Array<{
    id: number;
    amount: number;
    balance_after: number;
    source: string;
    note: string;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    amount: row.amount,
    balanceAfter: row.balance_after,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
  }));
  return { items, page, pageSize, totalItems: total.count, totalPages };
}

export function listCurrencyTransactionsPage(
  userId: number,
  requestedPage = 1,
  requestedPageSize = 10,
): CurrencyTransactionPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(requestedPageSize || 10), 1), 100);
  const total = db.prepare("SELECT COUNT(*) AS count FROM user_currency_transactions WHERE user_id = ?")
    .get(userId) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = Math.min(Math.max(Math.floor(requestedPage || 1), 1), totalPages);
  const items = (db.prepare(
    `SELECT id, currency, amount, balance_after, source, note, created_at
     FROM user_currency_transactions
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
  ).all(userId, pageSize, (page - 1) * pageSize) as Array<{
    id: number;
    currency: "soda" | "cookie";
    amount: number;
    balance_after: number;
    source: string;
    note: string;
    created_at: string;
  }>).map((row) => ({
    id: row.id,
    currency: row.currency,
    amount: row.amount,
    balanceAfter: row.balance_after,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
  }));
  return { items, page, pageSize, totalItems: total.count, totalPages };
}

export function listSodaTransactions(userId: number, limit = 20): SodaTransaction[] {
  return listSodaTransactionsPage(userId, 1, limit).items;
}

export function updateUserGrowth(input: {
  userId: number;
  sodaBalance: number;
  sodaExperience: number;
  cookieBalance?: number;
  adminName: string;
}): boolean {
  const sodaBalance = Math.min(Math.max(Math.floor(input.sodaBalance), 0), 2_000_000_000);
  const sodaExperience = Math.min(Math.max(Math.floor(input.sodaExperience), sodaBalance, 0), 2_000_000_000);
  const trustLevel = getUserLevelForExperience(sodaExperience);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db
      .prepare("SELECT soda_balance, cookie_balance FROM users WHERE id = ?")
      .get(input.userId) as { soda_balance: number; cookie_balance: number } | undefined;
    if (!current) {
      db.exec("ROLLBACK");
      return false;
    }
    const cookieBalance = input.cookieBalance == null
      ? current.cookie_balance
      : Math.min(Math.max(Math.floor(input.cookieBalance), 0), 2_000_000_000);
    db.prepare(
      `UPDATE users
       SET trust_level = ?, soda_balance = ?, soda_experience = ?, cookie_balance = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(trustLevel, sodaBalance, sodaExperience, cookieBalance, input.userId);
    const difference = sodaBalance - current.soda_balance;
    if (difference !== 0) {
      db.prepare(
        `INSERT INTO user_currency_transactions (
           user_id, currency, amount, balance_after, source, note
         )
         VALUES (?, 'soda', ?, ?, 'admin_adjustment', ?)`,
      ).run(input.userId, difference, sodaBalance, `由 ${input.adminName.slice(0, 40)} 调整`);
    }
    const cookieDifference = cookieBalance - current.cookie_balance;
    if (cookieDifference !== 0) {
      db.prepare(
        `INSERT INTO user_currency_transactions (
           user_id, currency, amount, balance_after, source, note
         )
         VALUES (?, 'cookie', ?, ?, 'admin_adjustment', ?)`,
      ).run(input.userId, cookieDifference, cookieBalance, `由 ${input.adminName.slice(0, 40)} 调整`);
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
