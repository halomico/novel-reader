import type { DatabaseSync } from "node:sqlite";
import { recordEngagementEvent, type EngagementAction } from "@/core/engagement/record";
import { getDb } from "@/lib/db";

export type OriginalEngagementResult = {
  recorded: boolean;
  counted: boolean;
  readingHistoryRecorded: boolean;
  duplicateEvent: boolean;
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

/** Explicit write command used only after verified client visibility. */
export function recordOriginalEngagement(input: {
  eventId: string;
  viewerKey: string;
  articleId: number;
  userId?: number | null;
  action?: EngagementAction;
  now?: number;
}): OriginalEngagementResult {
  if (!Number.isSafeInteger(input.articleId) || input.articleId <= 0) {
    return { recorded: false, counted: false, readingHistoryRecorded: false, duplicateEvent: false };
  }
  const action = input.action === "read_open" ? "read_open" : "detail_view";
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    let readingHistoryRecorded = false;
    let articleExists = false;
    const result = recordEngagementEvent(db, {
      eventId: input.eventId,
      viewerKey: input.viewerKey,
      contentType: "original",
      contentId: input.articleId,
      action,
      now: input.now,
      dedupeWindowMs: 30 * 60_000,
    }, (transaction) => {
      articleExists = transaction.prepare(
        "SELECT 1 AS found FROM original_articles WHERE id = ? AND status = 'published'",
      ).get(input.articleId) !== undefined;
      if (!articleExists) return;
      if (action === "detail_view") {
        transaction.prepare(
          "UPDATE original_articles SET view_count = view_count + 1 WHERE id = ? AND status = 'published'",
        ).run(input.articleId);
      }
      if (action === "read_open" && Number.isSafeInteger(input.userId) && Number(input.userId) > 0) {
        readingHistoryRecorded = recordReadingOpenInTransaction(transaction, Number(input.userId), input.articleId);
      }
    });
    if (!articleExists && result.counted) {
      db.exec("ROLLBACK");
      return { recorded: false, counted: false, readingHistoryRecorded: false, duplicateEvent: false };
    }
    db.exec("COMMIT");
    return {
      recorded: true,
      counted: result.counted,
      readingHistoryRecorded,
      duplicateEvent: result.duplicateEvent,
    };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Deliberate non-view opens remain available to internal commands and tests. */
export function recordOriginalReadingOpen(userId: number, articleId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(articleId) || articleId <= 0) return;
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    recordReadingOpenInTransaction(db, userId, articleId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
