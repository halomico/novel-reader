import type { DatabaseSync } from "node:sqlite";
import { getDb } from "@/lib/db";

export type OriginalEngagementResult = {
  recorded: boolean;
  readingHistoryRecorded: boolean;
};

function recordReadingOpenInTransaction(
  db: DatabaseSync,
  userId: number,
  articleId: number,
): boolean {
  const preferences = db.prepare(
    "SELECT original_reading_history_enabled FROM users WHERE id = ? AND status = 'active'",
  ).get(userId) as { original_reading_history_enabled: number } | undefined;
  if (!preferences) return false;

  if (preferences.original_reading_history_enabled !== 0) {
    db.prepare(
      `INSERT INTO original_reading_history (
         user_id, article_id, visit_count, recorded_in_history, last_read_at, updated_at
       )
       SELECT ?, id, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       FROM original_articles
       WHERE id = ? AND status = 'published'
       ON CONFLICT(user_id, article_id) DO UPDATE SET
         visit_count = original_reading_history.visit_count + 1,
         recorded_in_history = 1,
         last_read_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(userId, articleId);
  }
  db.prepare(
    `UPDATE user_original_grove
     SET visit_count = visit_count + 1
     WHERE user_id = ? AND article_id = ?`,
  ).run(userId, articleId);
  return preferences.original_reading_history_enabled !== 0;
}

/** Explicit write command used only after the article is actually visible. */
export function recordOriginalEngagement(
  articleId: number,
  userId?: number,
): OriginalEngagementResult {
  if (!Number.isSafeInteger(articleId) || articleId <= 0) {
    return { recorded: false, readingHistoryRecorded: false };
  }

  const db = getDb();
  db.exec("BEGIN");
  try {
    const recorded = db.prepare(
      "UPDATE original_articles SET view_count = view_count + 1 WHERE id = ? AND status = 'published'",
    ).run(articleId).changes > 0;
    const readingHistoryRecorded = recorded && Number.isSafeInteger(userId) && Number(userId) > 0
      ? recordReadingOpenInTransaction(db, Number(userId), articleId)
      : false;
    db.exec("COMMIT");
    return { recorded, readingHistoryRecorded };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Domain command retained for deliberate non-view opens such as grove tests. */
export function recordOriginalReadingOpen(userId: number, articleId: number): void {
  if (
    !Number.isSafeInteger(userId) || userId <= 0 ||
    !Number.isSafeInteger(articleId) || articleId <= 0
  ) return;
  const db = getDb();
  db.exec("BEGIN");
  try {
    recordReadingOpenInTransaction(db, userId, articleId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
