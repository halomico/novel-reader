import { getDb } from "./db";

export type ContentReportCategory = "tag_error" | "hotword_error" | "spam" | "other";
export type ContentReportStatus = "open" | "resolved";

export type ContentReport = {
  id: number;
  userId: number;
  username: string;
  userDisplayName: string;
  novelId: number;
  novelTitle: string;
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
  novel_id: number;
  novel_title: string;
  category: string;
  details: string;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

const CATEGORIES = new Set<ContentReportCategory>(["tag_error", "hotword_error", "spam", "other"]);

function toContentReport(row: ContentReportRow): ContentReport {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    userDisplayName: row.user_display_name,
    novelId: row.novel_id,
    novelTitle: row.novel_title,
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

export function createContentReport(params: {
  userId: number;
  novelId: number;
  category: ContentReportCategory;
  details: string;
  dailyLimit: number;
}): { ok: true; id: number } | { ok: false; reason: "invalid" | "limit" } {
  const userId = Number(params.userId);
  const novelId = Number(params.novelId);
  const details = params.details.trim();
  const dailyLimit = Math.min(Math.max(Math.floor(params.dailyLimit), 1), 500);
  if (!Number.isInteger(userId) || userId < 1 || !Number.isInteger(novelId) || novelId < 1 || details.length > 200) {
    return { ok: false, reason: "invalid" };
  }
  if (params.category === "other" && !details) {
    return { ok: false, reason: "invalid" };
  }

  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const eligible = db
      .prepare(
        `SELECT 1 AS found
         FROM users u, novels n
         WHERE u.id = ? AND u.status = 'active' AND u.role = 'user' AND n.id = ?`,
      )
      .get(userId, novelId);
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
      .prepare("INSERT INTO content_reports (user_id, novel_id, category, details) VALUES (?, ?, ?, ?)")
      .run(userId, novelId, params.category, details);
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
              r.novel_id, n.title AS novel_title, r.category, r.details, r.status,
              r.resolved_by, r.resolved_at, r.created_at, r.updated_at
       FROM content_reports r
       INNER JOIN users u ON u.id = r.user_id
       INNER JOIN novels n ON n.id = r.novel_id
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
