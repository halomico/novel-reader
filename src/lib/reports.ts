import { getDb } from "./db";
import type { MediaKind } from "./media";

export type ContentReportCategory =
  | "title_error"
  | "tag_error"
  | "hotword_error"
  | "playback_error"
  | "spam"
  | "other";
export type ContentReportStatus = "open" | "resolved";
export type ContentReportTargetType = "novel" | "media";

export type ContentReport = {
  id: number;
  userId: number;
  username: string;
  userDisplayName: string;
  targetType: ContentReportTargetType;
  targetId: number;
  targetTitle: string;
  mediaKind: MediaKind | null;
  category: ContentReportCategory;
  details: string;
  status: ContentReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentReportPage = {
  reports: ContentReport[];
  status: ContentReportStatus | "all";
  page: number;
  pageSize: number;
  totalReports: number;
  totalPages: number;
};

type ContentReportRow = {
  id: number;
  user_id: number;
  username: string;
  user_display_name: string;
  novel_id: number | null;
  media_id: number | null;
  target_title: string;
  media_kind: MediaKind | null;
  category: string;
  details: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORIES = new Set<ContentReportCategory>([
  "title_error",
  "tag_error",
  "hotword_error",
  "playback_error",
  "spam",
  "other",
]);
const MEDIA_CATEGORIES = new Set<ContentReportCategory>(["title_error", "playback_error", "spam", "other"]);

function toContentReport(row: ContentReportRow): ContentReport {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    userDisplayName: row.user_display_name,
    targetType: row.media_id ? "media" : "novel",
    targetId: row.media_id || row.novel_id || 0,
    targetTitle: row.target_title,
    mediaKind: row.media_kind,
    category: CATEGORIES.has(row.category as ContentReportCategory) ? row.category as ContentReportCategory : "other",
    details: row.details,
    status: row.status === "resolved" ? "resolved" : "open",
    resolvedBy: row.resolved_by,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function isContentReportCategory(value: unknown): value is ContentReportCategory {
  return CATEGORIES.has(value as ContentReportCategory);
}

export function isMediaReportCategory(value: unknown): value is ContentReportCategory {
  return MEDIA_CATEGORIES.has(value as ContentReportCategory);
}

export function createContentReport(params: {
  userId: number;
  novelId?: number | null;
  mediaId?: number | null;
  category: ContentReportCategory;
  details: string;
  dailyLimit: number;
}): { ok: true; id: number } | { ok: false; reason: "invalid" | "limit" } {
  const userId = Number(params.userId);
  const novelId = Number(params.novelId || 0);
  const mediaId = Number(params.mediaId || 0);
  const details = params.details.trim();
  const dailyLimit = Math.min(Math.max(Math.floor(params.dailyLimit), 1), 500);
  const hasNovel = Number.isInteger(novelId) && novelId > 0;
  const hasMedia = Number.isInteger(mediaId) && mediaId > 0;
  if (
    !Number.isInteger(userId) ||
    userId < 1 ||
    hasNovel === hasMedia ||
    details.length > 200 ||
    (hasMedia && !MEDIA_CATEGORIES.has(params.category))
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (params.category === "other" && !details) {
    return { ok: false, reason: "invalid" };
  }

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const eligible = hasNovel
      ? db
          .prepare(
            `SELECT 1 AS found
             FROM users u, novels n
             WHERE u.id = ? AND u.status = 'active' AND u.role = 'user' AND n.id = ?`,
          )
          .get(userId, novelId)
      : db
          .prepare(
             `SELECT 1 AS found
             FROM users u, media_assets m
             WHERE u.id = ? AND u.status = 'active' AND u.role = 'user'
               AND m.id = ? AND m.kind IN ('video', 'audio')`,
          )
          .get(userId, mediaId);
    if (!eligible) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "invalid" };
    }
    const today = db
      .prepare("SELECT COUNT(*) AS count FROM content_reports WHERE user_id = ? AND date(created_at) = date('now')")
      .get(userId) as { count: number };
    if (today.count >= dailyLimit) {
      db.exec("ROLLBACK");
      return { ok: false, reason: "limit" };
    }
    const result = db
      .prepare(
        `INSERT INTO content_reports (user_id, novel_id, media_id, category, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(userId, hasNovel ? novelId : null, hasMedia ? mediaId : null, params.category, details);
    db.exec("COMMIT");
    return { ok: true, id: Number(result.lastInsertRowid) };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listContentReports(params: {
  page?: number;
  pageSize?: number;
  status?: string;
} = {}): ContentReportPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 30), 1), 100);
  const status: ContentReportPage["status"] = params.status === "resolved" ? "resolved" : params.status === "all" ? "all" : "open";
  const where = status === "all" ? "" : "WHERE r.status = ?";
  const bind = status === "all" ? [] : [status];
  const total = db.prepare(`SELECT COUNT(*) AS count FROM content_reports r ${where}`).get(...bind) as { count: number };
  const totalPages = Math.max(1, Math.ceil(total.count / pageSize));
  const requestedPage = Number(params.page || 1);
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1, 1), totalPages);
  const rows = db
    .prepare(
      `SELECT r.id, r.user_id, u.username, u.display_name AS user_display_name,
              r.novel_id, r.media_id, COALESCE(n.title, m.title, '已删除内容') AS target_title,
              m.kind AS media_kind, r.category, r.details, r.status,
              r.resolved_by, r.resolved_at, r.created_at, r.updated_at
       FROM content_reports r
       INNER JOIN users u ON u.id = r.user_id
       LEFT JOIN novels n ON n.id = r.novel_id
       LEFT JOIN media_assets m ON m.id = r.media_id
       ${where}
       ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...bind, pageSize, (page - 1) * pageSize) as ContentReportRow[];
  return {
    reports: rows.map(toContentReport),
    status,
    page,
    pageSize,
    totalReports: total.count,
    totalPages,
  };
}

export function setContentReportStatus(id: number, status: ContentReportStatus, resolvedBy: string): boolean {
  const result = status === "resolved"
    ? getDb()
        .prepare(
          `UPDATE content_reports
           SET status = 'resolved', resolved_by = ?, resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(resolvedBy.trim().slice(0, 64), id)
    : getDb()
        .prepare(
          `UPDATE content_reports
           SET status = 'open', resolved_by = NULL, resolved_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(id);
  return Number(result.changes) > 0;
}

export function deleteContentReport(id: number): boolean {
  return getDb().prepare("DELETE FROM content_reports WHERE id = ?").run(id).changes > 0;
}
