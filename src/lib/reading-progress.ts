import type { Novel } from "./books";
import { getDb } from "./db";

export type ReadingProgress = {
  historyId: number;
  novelId: number;
  title: string;
  segmentIndex: number;
  segmentRatio: number;
  progressPercent: number;
  contentVersion: string;
  completed: boolean;
  visitCount: number;
  lastReadAt: string;
};

export type ReadingProgressPage = {
  items: ReadingProgress[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type ReadingProgressUpdate = {
  segmentIndex: number;
  segmentRatio: number;
  progressPercent: number;
  contentVersion: string;
  completed: boolean;
};

type ReadingProgressRow = {
  id: number;
  novel_id: number;
  title: string;
  segment_index: number;
  segment_ratio: number;
  progress_percent: number;
  content_version: string;
  completed: number;
  visit_count: number;
  last_read_at: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(Number.isFinite(value) ? value : minimum, minimum), maximum);
}

function normalizePage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

function toReadingProgress(row: ReadingProgressRow): ReadingProgress {
  return {
    historyId: row.id,
    novelId: row.novel_id,
    title: row.title,
    segmentIndex: Math.max(Math.floor(row.segment_index || 0), 0),
    segmentRatio: clamp(row.segment_ratio, 0, 1),
    progressPercent: clamp(row.progress_percent, 0, 100),
    contentVersion: row.content_version || "",
    completed: row.completed === 1,
    visitCount: Math.max(Math.floor(row.visit_count || 0), 0),
    lastReadAt: row.last_read_at,
  };
}

function readingPreferences(userId: number): { historyEnabled: boolean } {
  const row = getDb()
    .prepare(
      `SELECT reading_history_enabled
       FROM users
       WHERE id = ? AND status = 'active'`,
    )
    .get(userId) as { reading_history_enabled: number } | undefined;
  return {
    historyEnabled: row?.reading_history_enabled !== 0 && Boolean(row),
  };
}

export function novelContentVersion(
  book: Pick<Novel, "content_hash" | "size_bytes" | "mtime_ms">,
): string {
  return book.content_hash || `${book.size_bytes}:${Math.floor(book.mtime_ms)}`;
}

export function recordReadingOpen(userId: number, book: Novel): void {
  const db = getDb();
  const preferences = readingPreferences(userId);
  const existing = db.prepare(
    `SELECT progress_percent, completed, content_version
     FROM user_reading_history
     WHERE user_id = ? AND novel_id = ?`,
  ).get(userId, book.id) as {
    progress_percent: number;
    completed: number;
    content_version: string;
  } | undefined;
  const contentVersion = novelContentVersion(book);
  const resumed = Boolean(
    existing &&
    existing.completed === 0 &&
    existing.content_version === contentVersion &&
    existing.progress_percent >= 1,
  );

  db.exec("BEGIN");
  try {
    if (preferences.historyEnabled) {
      db.prepare(
        `INSERT INTO user_reading_history (
           user_id, novel_id, title, content_version, recorded_in_history, visit_count,
           last_read_at, updated_at
         )
         VALUES (?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, novel_id) DO UPDATE SET
           title = excluded.title,
           content_version = CASE
             WHEN user_reading_history.progress_percent <= 0 THEN excluded.content_version
             ELSE user_reading_history.content_version
           END,
           recorded_in_history = 1,
           visit_count = user_reading_history.visit_count + 1,
           last_read_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`,
      ).run(userId, book.id, book.title, contentVersion);
    }

    db.prepare(
      `INSERT INTO novel_read_daily_stats (
         day, novel_id, open_count, resume_count, updated_at
       )
       VALUES (date('now'), ?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(day, novel_id) DO UPDATE SET
         open_count = novel_read_daily_stats.open_count + 1,
         resume_count = novel_read_daily_stats.resume_count + excluded.resume_count,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(book.id, resumed ? 1 : 0);
    db.prepare(
      `INSERT INTO user_read_daily_stats (
         day, user_id, open_count, resume_count, updated_at
       )
       VALUES (date('now'), ?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(day, user_id) DO UPDATE SET
         open_count = user_read_daily_stats.open_count + 1,
         resume_count = user_read_daily_stats.resume_count + excluded.resume_count,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(userId, resumed ? 1 : 0);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getReadingProgress(userId: number, novelId: number): ReadingProgress | null {
  const row = getDb()
    .prepare(
      `SELECT id, novel_id, title, segment_index, segment_ratio, progress_percent,
              content_version, completed, visit_count, last_read_at
       FROM user_reading_history
       WHERE user_id = ? AND novel_id = ?`,
    )
    .get(userId, novelId) as ReadingProgressRow | undefined;
  return row ? toReadingProgress(row) : null;
}

export function updateReadingProgress(
  userId: number,
  book: Novel,
  update: ReadingProgressUpdate,
): { saved: boolean; progress: ReadingProgress | null } {
  const preferences = readingPreferences(userId);
  const db = getDb();
  const existing = getReadingProgress(userId, book.id);
  const contentVersion = novelContentVersion(book);
  const versionChanged = Boolean(existing?.contentVersion && existing.contentVersion !== contentVersion);
  const segmentIndex = Math.max(Math.floor(update.segmentIndex || 0), 0);
  const segmentRatio = clamp(update.segmentRatio, 0, 1);
  const progressPercent = clamp(update.progressPercent, 0, 100);
  const completed = update.completed || progressPercent >= 98;
  const previousPercent = versionChanged ? 0 : existing?.progressPercent || 0;
  const previousCompleted = versionChanged ? false : existing?.completed || false;
  const moved = !existing ||
    versionChanged ||
    existing.segmentIndex !== segmentIndex ||
    Math.abs(existing.segmentRatio - segmentRatio) >= 0.02 ||
    Math.abs(previousPercent - progressPercent) >= 0.5 ||
    completed !== previousCompleted;
  if (!moved) {
    return { saved: false, progress: existing };
  }

  const nextCompleted = previousCompleted || completed;
  const completionDelta = nextCompleted && !previousCompleted ? 1 : 0;
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO user_reading_history (
         user_id, novel_id, title, segment_index, segment_ratio,
         progress_percent, content_version, completed, recorded_in_history, visit_count,
         last_read_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, novel_id) DO UPDATE SET
         title = excluded.title,
         segment_index = excluded.segment_index,
         segment_ratio = excluded.segment_ratio,
         progress_percent = excluded.progress_percent,
         content_version = excluded.content_version,
         completed = excluded.completed,
         recorded_in_history = CASE
           WHEN excluded.recorded_in_history = 1 THEN 1
           ELSE user_reading_history.recorded_in_history
         END,
         last_read_at = CASE
           WHEN excluded.recorded_in_history = 1 THEN CURRENT_TIMESTAMP
           ELSE user_reading_history.last_read_at
         END,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(
      userId,
      book.id,
      book.title,
      segmentIndex,
      segmentRatio,
      progressPercent,
      contentVersion,
      nextCompleted ? 1 : 0,
      preferences.historyEnabled ? 1 : 0,
    );
    db.prepare(
      `INSERT INTO novel_read_daily_stats (
         day, novel_id, completion_count, progress_sample_count,
         progress_percent_sum, updated_at
       )
       VALUES (date('now'), ?, ?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(day, novel_id) DO UPDATE SET
         completion_count = novel_read_daily_stats.completion_count + excluded.completion_count,
         progress_sample_count = novel_read_daily_stats.progress_sample_count + 1,
         progress_percent_sum = novel_read_daily_stats.progress_percent_sum + excluded.progress_percent_sum,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(book.id, completionDelta, progressPercent);
    db.prepare(
      `INSERT INTO user_read_daily_stats (
         day, user_id, completion_count, progress_update_count, updated_at
       )
       VALUES (date('now'), ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(day, user_id) DO UPDATE SET
         completion_count = user_read_daily_stats.completion_count + excluded.completion_count,
         progress_update_count = user_read_daily_stats.progress_update_count + 1,
         updated_at = CURRENT_TIMESTAMP`,
    ).run(userId, completionDelta);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { saved: true, progress: getReadingProgress(userId, book.id) };
}

export function listReadingProgressPage(
  userId: number,
  params: { page?: number; pageSize?: number } = {},
): ReadingProgressPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 20), 1), 100);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM user_reading_history h
       INNER JOIN novels n ON n.id = h.novel_id
       WHERE h.user_id = ? AND h.recorded_in_history = 1`,
    )
    .get(userId) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const page = normalizePage(params.page || 1, totalPages);
  const rows = db
    .prepare(
      `SELECT h.id, h.novel_id, n.title, h.segment_index, h.segment_ratio,
              h.progress_percent, h.content_version, h.completed,
              h.visit_count, h.last_read_at
       FROM user_reading_history h
       INNER JOIN novels n ON n.id = h.novel_id
       WHERE h.user_id = ? AND h.recorded_in_history = 1
       ORDER BY
         CASE WHEN h.id = (
           SELECT latest.id
           FROM user_reading_history latest
           WHERE latest.user_id = ?
             AND latest.recorded_in_history = 1
             AND latest.completed = 0
             AND latest.progress_percent > 0
           ORDER BY latest.last_read_at DESC, latest.id DESC
           LIMIT 1
         ) THEN 0 ELSE 1 END,
         h.last_read_at DESC,
         h.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, userId, pageSize, (page - 1) * pageSize) as ReadingProgressRow[];
  return {
    items: rows.map(toReadingProgress),
    page,
    pageSize,
    totalItems: total.count,
    totalPages,
  };
}

export function listRecentReadingProgress(userId: number, limit = 3): ReadingProgress[] {
  const pageSize = Math.min(Math.max(Math.floor(limit), 1), 100);
  return listReadingProgressPage(userId, { page: 1, pageSize }).items;
}

export function deleteReadingProgress(userId: number, novelId: number): boolean {
  const info = getDb()
    .prepare(
      `UPDATE user_reading_history
       SET recorded_in_history = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND novel_id = ? AND recorded_in_history = 1`,
    )
    .run(userId, novelId);
  return Number(info.changes) > 0;
}

export function deleteReadingProgressMany(userId: number, novelIds: number[]): number {
  const ids = Array.from(new Set(
    novelIds.filter((id) => Number.isInteger(id) && id > 0),
  )).slice(0, 100);
  if (!ids.length) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(", ");
  const info = getDb()
    .prepare(
      `UPDATE user_reading_history
       SET recorded_in_history = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND recorded_in_history = 1
         AND novel_id IN (${placeholders})`,
    )
    .run(userId, ...ids);
  return Number(info.changes);
}

export function clearReadingProgress(userId: number): number {
  const info = getDb()
    .prepare(
      `UPDATE user_reading_history
       SET recorded_in_history = 0, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND recorded_in_history = 1`,
    )
    .run(userId);
  return Number(info.changes);
}

export type ReadingAnalyticsMetric = {
  id: number;
  label: string;
  opens: number;
  resumes: number;
  completions: number;
  averageProgress: number;
};

export type UserReadingAnalyticsMetric = Omit<ReadingAnalyticsMetric, "averageProgress">;

export type ReadingAnalytics = {
  opens: number;
  resumes: number;
  completions: number;
  averageProgress: number;
  novels: ReadingAnalyticsMetric[];
  users: UserReadingAnalyticsMetric[];
};

export function getReadingAnalytics(days = 30, limit = 20): ReadingAnalytics {
  const db = getDb();
  const normalizedDays = Math.min(Math.max(Math.floor(days), 1), 365);
  const normalizedLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  const modifier = `-${normalizedDays - 1} days`;
  const summary = db.prepare(
    `SELECT COALESCE(SUM(open_count), 0) AS opens,
            COALESCE(SUM(resume_count), 0) AS resumes,
            COALESCE(SUM(completion_count), 0) AS completions,
            COALESCE(SUM(progress_percent_sum), 0) AS progress_sum,
            COALESCE(SUM(progress_sample_count), 0) AS progress_samples
     FROM novel_read_daily_stats
     WHERE day >= date('now', ?)`,
  ).get(modifier) as {
    opens: number;
    resumes: number;
    completions: number;
    progress_sum: number;
    progress_samples: number;
  };
  const novels = db.prepare(
    `SELECT n.id, n.title AS label,
            SUM(s.open_count) AS opens,
            SUM(s.resume_count) AS resumes,
            SUM(s.completion_count) AS completions,
            COALESCE(SUM(s.progress_percent_sum) / NULLIF(SUM(s.progress_sample_count), 0), 0) AS average_progress
     FROM novel_read_daily_stats s
     INNER JOIN novels n ON n.id = s.novel_id
     WHERE s.day >= date('now', ?)
     GROUP BY n.id, n.title
     ORDER BY opens DESC, resumes DESC, n.id ASC
     LIMIT ?`,
  ).all(modifier, normalizedLimit) as Array<{
    id: number;
    label: string;
    opens: number;
    resumes: number;
    completions: number;
    average_progress: number;
  }>;
  const users = db.prepare(
    `SELECT u.id, u.display_name AS label,
            SUM(s.open_count) AS opens,
            SUM(s.resume_count) AS resumes,
            SUM(s.completion_count) AS completions
     FROM user_read_daily_stats s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.day >= date('now', ?)
     GROUP BY u.id, u.display_name
     ORDER BY opens DESC, resumes DESC, u.id ASC
     LIMIT ?`,
  ).all(modifier, normalizedLimit) as Array<{
    id: number;
    label: string;
    opens: number;
    resumes: number;
    completions: number;
  }>;
  return {
    opens: Number(summary.opens || 0),
    resumes: Number(summary.resumes || 0),
    completions: Number(summary.completions || 0),
    averageProgress: summary.progress_samples > 0
      ? Number(summary.progress_sum || 0) / Number(summary.progress_samples)
      : 0,
    novels: novels.map((row) => ({
      id: row.id,
      label: row.label,
      opens: Number(row.opens || 0),
      resumes: Number(row.resumes || 0),
      completions: Number(row.completions || 0),
      averageProgress: Number(row.average_progress || 0),
    })),
    users: users.map((row) => ({
      id: row.id,
      label: row.label,
      opens: Number(row.opens || 0),
      resumes: Number(row.resumes || 0),
      completions: Number(row.completions || 0),
    })),
  };
}
