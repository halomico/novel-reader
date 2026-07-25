import { getDb } from "./db";
import { getSiteDateKey } from "./user-economy";

export type NovelRecommendationState = {
  recommended: boolean;
  count: number;
  sodaBalance: number;
};

export function getNovelRecommendationCount(novelId: number): number {
  if (!Number.isInteger(novelId) || novelId < 1) {
    return 0;
  }
  const row = getDb()
    .prepare("SELECT recommend_count FROM novels WHERE id = ?")
    .get(novelId) as { recommend_count: number } | undefined;
  return Math.max(row?.recommend_count || 0, 0);
}

export function getNovelRecommendationState(userId: number, novelId: number, now = new Date()): NovelRecommendationState {
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(novelId) || novelId < 1) {
    return { recommended: false, count: 0, sodaBalance: 0 };
  }
  const row = getDb()
    .prepare(
      `SELECT n.recommend_count AS count, u.soda_balance AS soda_balance,
              EXISTS(
                SELECT 1 FROM novel_recommendations r
                WHERE r.user_id = u.id AND r.novel_id = n.id AND r.recommendation_date = ?
              ) AS recommended
       FROM users u, novels n
       WHERE u.id = ? AND n.id = ?`,
    )
    .get(getSiteDateKey(now), userId, novelId) as {
    count: number;
    soda_balance: number;
    recommended: number;
  } | undefined;
  return {
    recommended: row?.recommended === 1,
    count: Math.max(row?.count || 0, 0),
    sodaBalance: Math.max(row?.soda_balance || 0, 0),
  };
}

export function recommendNovelWithSoda(
  userId: number,
  novelId: number,
  cost = 1,
  now = new Date(),
):
  | ({ ok: true; alreadyRecommended: boolean } & NovelRecommendationState)
  | { ok: false; reason: "invalid" | "insufficient_soda" } {
  const normalizedCost = Math.min(Math.max(Math.floor(cost), 1), 100);
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(novelId) || novelId < 1) {
    return { ok: false, reason: "invalid" };
  }

  const db = getDb();
  const recommendationDate = getSiteDateKey(now);
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        `SELECT u.status, u.soda_balance, n.title, n.recommend_count,
                EXISTS(
                  SELECT 1 FROM novel_recommendations r
                  WHERE r.user_id = u.id AND r.novel_id = n.id AND r.recommendation_date = ?
                ) AS recommended
         FROM users u, novels n
         WHERE u.id = ? AND n.id = ?`,
      )
      .get(recommendationDate, userId, novelId) as {
      status: string;
      soda_balance: number;
      title: string;
      recommend_count: number;
      recommended: number;
    } | undefined;
    if (!row || row.status !== "active") {
      db.exec("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    if (row.recommended === 1) {
      db.exec("COMMIT");
      return {
        ok: true,
        alreadyRecommended: true,
        recommended: true,
        count: row.recommend_count,
        sodaBalance: row.soda_balance,
      };
    }
    if (row.soda_balance < normalizedCost) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "insufficient_soda" };
    }

    const balance = row.soda_balance - normalizedCost;
    db.prepare("UPDATE users SET soda_balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(balance, userId);
    db.prepare(
      `INSERT INTO novel_recommendations (novel_id, user_id, recommendation_date, soda_spent)
       VALUES (?, ?, ?, ?)`,
    ).run(novelId, userId, recommendationDate, normalizedCost);
    db.prepare(
      `INSERT INTO user_soda_transactions (user_id, amount, balance_after, source, note)
       VALUES (?, ?, ?, 'novel_recommendation', ?)`,
    ).run(userId, -normalizedCost, balance, `推荐《${row.title.slice(0, 80)}》`);
    db.exec("COMMIT");
    return {
      ok: true,
      alreadyRecommended: false,
      recommended: true,
      count: row.recommend_count + 1,
      sodaBalance: balance,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setNovelRecommendationCount(novelId: number, count: number): boolean {
  const normalized = Math.min(Math.max(Math.floor(count), 0), 2_000_000_000);
  return getDb()
    .prepare("UPDATE novels SET recommend_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(normalized, novelId).changes > 0;
}
