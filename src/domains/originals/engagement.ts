import type { QueryResultRow } from "pg";
import { recordPostgresEngagementEvent, type EngagementAction } from "@/core/engagement/record";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";

export type OriginalEngagementResult = Readonly<{
  recorded: boolean;
  counted: boolean;
  readingHistoryRecorded: boolean;
  duplicateEvent: boolean;
}>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

async function recordReadingOpenInTransaction(
  executor: SqlExecutor,
  userId: number,
  articleId: number,
): Promise<boolean> {
  const result = await executor.query<QueryResultRow & { original_reading_history_enabled: boolean }>({
    text: `SELECT original_reading_history_enabled FROM users
      WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
    values: [userId],
  });
  const enabled = result.rows[0]?.original_reading_history_enabled === true;
  if (!result.rows[0]) return false;
  if (enabled) {
    await executor.query({
      text: `INSERT INTO original_reading_history
        (user_id, article_id, visit_count, recorded_in_history, last_read_at, updated_at)
        SELECT $1, id, 1, TRUE, clock_timestamp(), clock_timestamp()
        FROM original_articles WHERE id = $2 AND status = 'published'
        ON CONFLICT (user_id, article_id) DO UPDATE SET
          visit_count = original_reading_history.visit_count + 1,
          recorded_in_history = TRUE,
          last_read_at = clock_timestamp(), updated_at = clock_timestamp()`,
      values: [userId, articleId],
    });
  }
  return enabled;
}

export async function recordOriginalEngagement(
  input: {
    eventId: string;
    viewerKey: string;
    articleId: number;
    userId?: number | null;
    action?: EngagementAction;
    now?: number;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<OriginalEngagementResult> {
  if (!Number.isSafeInteger(input.articleId) || input.articleId <= 0) {
    return { recorded: false, counted: false, readingHistoryRecorded: false, duplicateEvent: false };
  }
  const action = input.action === "read_open" ? "read_open" : "detail_view";
  return transaction(async (tx) => {
    const article = await tx.query({
      text: "SELECT 1 FROM original_articles WHERE id = $1 AND status = 'published' FOR KEY SHARE",
      values: [input.articleId],
    });
    if (!article.rowCount) {
      return { recorded: false, counted: false, readingHistoryRecorded: false, duplicateEvent: false };
    }
    let readingHistoryRecorded = false;
    const result = await recordPostgresEngagementEvent(tx, {
      eventId: input.eventId,
      viewerKey: input.viewerKey,
      contentType: "original",
      contentId: input.articleId,
      action,
      now: input.now,
      dedupeWindowMs: 30 * 60_000,
    }, async (executor) => {
      if (action === "detail_view") {
        await executor.query({
          text: `UPDATE original_articles SET view_count = view_count + 1,
            updated_at = updated_at WHERE id = $1 AND status = 'published'`,
          values: [input.articleId],
        });
      } else if (Number.isSafeInteger(input.userId) && Number(input.userId) > 0) {
        readingHistoryRecorded = await recordReadingOpenInTransaction(executor, Number(input.userId), input.articleId);
      }
    });
    if (
      action === "detail_view"
      && !result.duplicateEvent
      && Number.isSafeInteger(input.userId)
      && Number(input.userId) > 0
    ) {
      await tx.query({
        text: `UPDATE user_original_grove SET visit_count = visit_count + 1
          WHERE user_id = $1 AND article_id = $2`,
        values: [Number(input.userId), input.articleId],
      });
    }
    return {
      recorded: true,
      counted: result.counted,
      readingHistoryRecorded,
      duplicateEvent: result.duplicateEvent,
    };
  });
}

export async function recordOriginalReadingOpen(
  userId: number,
  articleId: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<void> {
  if (!Number.isSafeInteger(userId) || userId <= 0 || !Number.isSafeInteger(articleId) || articleId <= 0) return;
  await transaction(async (tx) => {
    await recordReadingOpenInTransaction(tx, userId, articleId);
  });
}
