import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";

export type PostgresOriginalAccess = Readonly<{
  exists: boolean;
  allowed: boolean;
  purchased: boolean;
}>;
export type PostgresOriginalReadingProgress = Readonly<{
  articleId: number;
  scrollRatio: number;
  progressPercent: number;
  completed: boolean;
  visitCount: number;
  lastReadAt: string;
}>;
export type PostgresOriginalReadingHistoryItem = PostgresOriginalReadingProgress & Readonly<{
  slug: string;
  title: string;
  authorId: number;
  authorName: string;
  authorAvatarPath: string | null;
  wordCount: number;
  unlockSodaPrice: number;
}>;
export type PostgresOriginalReadingHistoryPage = Readonly<{
  items: PostgresOriginalReadingHistoryItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

type ProgressRow = QueryResultRow & {
  article_id: string | number;
  scroll_ratio: string | number;
  progress_percent: string | number;
  completed: boolean;
  visit_count: string | number;
  last_read_at: Date | string;
};
type HistoryRow = ProgressRow & {
  total_items: string | number;
  total_pages: string | number;
  page: string | number;
  slug: string;
  title: string;
  author_id: string | number;
  author_name: string;
  author_avatar_path: string | null;
  word_count: string | number;
  unlock_soda_price: string | number;
};

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function count(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function ratio(value: string | number, maximum: number, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > maximum) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid PostgreSQL original reading timestamp");
  return date.toISOString();
}

function progress(row: ProgressRow): PostgresOriginalReadingProgress {
  return {
    articleId: positiveId(Number(row.article_id), "original article id"),
    scrollRatio: ratio(row.scroll_ratio, 1, "original scroll ratio"),
    progressPercent: ratio(row.progress_percent, 100, "original progress percent"),
    completed: row.completed === true,
    visitCount: count(row.visit_count, "original visit count"),
    lastReadAt: timestamp(row.last_read_at),
  };
}

export async function getPostgresOriginalAccess(
  executor: SqlExecutor,
  articleIdValue: number,
  user: { id: number; role: "user" | "admin" } | null,
): Promise<PostgresOriginalAccess> {
  const articleId = positiveId(articleIdValue, "original article id");
  const userId = user ? positiveId(user.id, "user id") : null;
  const result = await executor.query<QueryResultRow & { exists: boolean; purchased: boolean; allowed: boolean }>({
    name: "original-reading-access-v1",
    text: `SELECT TRUE AS exists,
        EXISTS (SELECT 1 FROM original_purchases purchase WHERE purchase.article_id = article.id AND purchase.buyer_id = $2) AS purchased,
        (article.status = 'published' AND (
          article.access_mode = 'free' OR $3::boolean OR article.author_id = $2 OR
          EXISTS (SELECT 1 FROM original_purchases purchase WHERE purchase.article_id = article.id AND purchase.buyer_id = $2)
        )) AS allowed
      FROM original_articles article WHERE article.id = $1`,
    values: [articleId, userId, user?.role === "admin"],
  });
  const row = result.rows[0];
  return { exists: row?.exists === true, purchased: row?.purchased === true, allowed: row?.allowed === true };
}

export async function getPostgresOriginalReadingProgress(
  executor: SqlExecutor,
  userIdValue: number,
  articleIdValue: number,
): Promise<PostgresOriginalReadingProgress | null> {
  const result = await executor.query<ProgressRow>({
    name: "original-reading-progress-v1",
    text: `SELECT article_id, scroll_ratio, progress_percent, completed, visit_count, last_read_at
      FROM original_reading_history WHERE user_id = $1 AND article_id = $2`,
    values: [positiveId(userIdValue, "user id"), positiveId(articleIdValue, "original article id")],
  });
  return result.rows[0] ? progress(result.rows[0]) : null;
}

export async function updatePostgresOriginalReadingProgress(
  executor: SqlExecutor,
  userIdValue: number,
  articleIdValue: number,
  scrollRatioValue: number,
): Promise<{ saved: boolean; progress: PostgresOriginalReadingProgress | null }> {
  const userId = positiveId(userIdValue, "user id");
  const articleId = positiveId(articleIdValue, "original article id");
  if (!Number.isFinite(scrollRatioValue) || scrollRatioValue < 0 || scrollRatioValue > 1) throw new TypeError("Invalid PostgreSQL original scroll ratio");
  const scrollRatio = Math.min(Math.max(scrollRatioValue, 0), 1);
  const result = await executor.query<ProgressRow>({
    text: `INSERT INTO original_reading_history
        (user_id, article_id, scroll_ratio, progress_percent, completed, recorded_in_history, visit_count, last_read_at, updated_at)
      SELECT account.id, article.id, $3::double precision, ($3::double precision * 100), ($3::double precision * 100 >= 98), TRUE, 0, clock_timestamp(), clock_timestamp()
      FROM users account JOIN original_articles article ON article.id = $2 AND article.status = 'published'
      WHERE account.id = $1 AND account.status = 'active' AND account.deleted_at IS NULL
        AND account.original_reading_history_enabled = TRUE
        AND (article.access_mode = 'free' OR article.author_id = account.id OR account.role = 'admin'
          OR EXISTS (SELECT 1 FROM original_purchases purchase
            WHERE purchase.article_id = article.id AND purchase.buyer_id = account.id))
      ON CONFLICT (user_id, article_id) DO UPDATE SET
        scroll_ratio = EXCLUDED.scroll_ratio,
        progress_percent = EXCLUDED.progress_percent,
        completed = original_reading_history.completed OR EXCLUDED.completed,
        recorded_in_history = TRUE,
        last_read_at = clock_timestamp(), updated_at = clock_timestamp()
      WHERE abs(original_reading_history.scroll_ratio - EXCLUDED.scroll_ratio) >= 0.002
         OR (NOT original_reading_history.completed AND EXCLUDED.completed)
         OR NOT original_reading_history.recorded_in_history
      RETURNING article_id, scroll_ratio, progress_percent, completed, visit_count, last_read_at`,
    values: [userId, articleId, scrollRatio],
  });
  if (result.rows[0]) return { saved: true, progress: progress(result.rows[0]) };
  return { saved: false, progress: await getPostgresOriginalReadingProgress(executor, userId, articleId) };
}

function normalizedIds(values: readonly number[]): number[] {
  const unique = [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))];
  if (unique.length > 100) throw new TypeError("Too many PostgreSQL original reading ids");
  return unique;
}

export async function deletePostgresOriginalReadingProgressMany(
  executor: SqlExecutor,
  userIdValue: number,
  articleIds: readonly number[],
): Promise<number> {
  const ids = normalizedIds(articleIds);
  if (!ids.length) return 0;
  const result = await executor.query({
    text: `UPDATE original_reading_history SET recorded_in_history = FALSE, updated_at = clock_timestamp()
      WHERE user_id = $1 AND recorded_in_history = TRUE AND article_id = ANY($2::bigint[])`,
    values: [positiveId(userIdValue, "user id"), ids],
  });
  return result.rowCount ?? 0;
}

export async function clearPostgresOriginalReadingProgress(executor: SqlExecutor, userIdValue: number): Promise<number> {
  const result = await executor.query({
    text: `UPDATE original_reading_history SET recorded_in_history = FALSE, updated_at = clock_timestamp()
      WHERE user_id = $1 AND recorded_in_history = TRUE`,
    values: [positiveId(userIdValue, "user id")],
  });
  return result.rowCount ?? 0;
}

export async function listPostgresOriginalReadingHistory(
  executor: SqlExecutor,
  userIdValue: number,
  options: { page?: number; pageSize?: number } = {},
): Promise<PostgresOriginalReadingHistoryPage> {
  const userId = positiveId(userIdValue, "user id");
  const pageSize = Number.isFinite(options.pageSize) ? Math.min(Math.max(Math.floor(options.pageSize ?? 20), 1), 100) : 20;
  const requestedPage = Number.isFinite(options.page) ? Math.max(Math.floor(options.page ?? 1), 1) : 1;
  const result = await executor.query<HistoryRow>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items,
               GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages
        FROM original_reading_history history JOIN original_articles article ON article.id = history.article_id
        WHERE history.user_id = $1 AND history.recorded_in_history = TRUE AND article.status = 'published'
      ), requested AS (
        SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.total_items, requested.total_pages, requested.page, item.*
      FROM requested LEFT JOIN LATERAL (
        SELECT history.article_id, history.visit_count, history.scroll_ratio, history.progress_percent,
               history.completed, history.last_read_at, article.slug, article.title, article.author_id,
               account.display_name AS author_name, account.avatar_path AS author_avatar_path,
               article.word_count, article.unlock_soda_price
        FROM original_reading_history history
        JOIN original_articles article ON article.id = history.article_id
        JOIN users account ON account.id = article.author_id
        WHERE history.user_id = $1 AND history.recorded_in_history = TRUE AND article.status = 'published'
        ORDER BY history.last_read_at DESC, history.article_id DESC
        LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [userId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL original history page metadata is missing");
  const items = result.rows.flatMap((row): PostgresOriginalReadingHistoryItem[] => row.article_id == null ? [] : [{
    ...progress(row), slug: row.slug, title: row.title,
    authorId: positiveId(Number(row.author_id), "original author id"), authorName: row.author_name,
    authorAvatarPath: row.author_avatar_path, wordCount: count(row.word_count, "original word count"),
    unlockSodaPrice: count(row.unlock_soda_price, "original unlock price"),
  }]);
  return {
    items, page: count(first.page, "original history page"), pageSize,
    totalItems: count(first.total_items, "original history total"), totalPages: count(first.total_pages, "original history pages"),
  };
}
