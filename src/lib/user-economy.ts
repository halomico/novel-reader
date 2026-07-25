import crypto from "node:crypto";
import { getDb } from "./db";

export type SodaTransaction = {
  id: number;
  amount: number;
  balanceAfter: number;
  source: string;
  note: string;
  createdAt: string;
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
      .prepare("SELECT status, soda_balance FROM users WHERE id = ?")
      .get(userId) as { status: string; soda_balance: number } | undefined;
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
    db.prepare("INSERT INTO user_checkins (user_id, checkin_date, reward) VALUES (?, ?, ?)")
      .run(userId, date, reward);
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(balance, userId);
    db.prepare(
      `INSERT INTO user_soda_transactions (user_id, amount, balance_after, source, note)
       VALUES (?, ?, ?, 'daily_checkin', '每日签到')`,
    ).run(userId, reward, balance);
    db.exec("COMMIT");
    return { ok: true, reward, balance, alreadyCheckedIn: false };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listSodaTransactions(userId: number, limit = 20): SodaTransaction[] {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  return (getDb()
    .prepare(
      `SELECT id, amount, balance_after, source, note, created_at
       FROM user_soda_transactions
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(userId, safeLimit) as Array<{
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
}

export function updateUserGrowth(input: {
  userId: number;
  trustLevel: number;
  sodaBalance: number;
  adminName: string;
}): boolean {
  const trustLevel = Math.min(Math.max(Math.floor(input.trustLevel), 0), 6);
  const sodaBalance = Math.min(Math.max(Math.floor(input.sodaBalance), 0), 2_000_000_000);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db
      .prepare("SELECT soda_balance FROM users WHERE id = ?")
      .get(input.userId) as { soda_balance: number } | undefined;
    if (!current) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare(
      `UPDATE users
       SET trust_level = ?, soda_balance = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(trustLevel, sodaBalance, input.userId);
    const difference = sodaBalance - current.soda_balance;
    if (difference !== 0) {
      db.prepare(
        `INSERT INTO user_soda_transactions (user_id, amount, balance_after, source, note)
         VALUES (?, ?, ?, 'admin_adjustment', ?)`,
      ).run(input.userId, difference, sodaBalance, `由 ${input.adminName.slice(0, 40)} 调整`);
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
