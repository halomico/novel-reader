import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor, type SqlQuery } from "@/core/db/postgres";
import { getTelegramConfig } from "@/lib/telegram-config";

export type ContentReportCategory = "title_error" | "tag_error" | "hotword_error" | "playback_error" | "spam" | "other";
export type ContentReportStatus = "open" | "resolved";
export type ContentReportTargetType = "novel" | "media" | "original";
export type ReportMediaKind = "video" | "audio" | "file";

export type ContentReport = Readonly<{
  id: number;
  userId: number;
  username: string;
  userDisplayName: string;
  targetType: ContentReportTargetType;
  targetId: number;
  targetTitle: string;
  targetSlug: string | null;
  mediaKind: ReportMediaKind | null;
  category: ContentReportCategory;
  details: string;
  status: ContentReportStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type ContentReportPage = Readonly<{
  reports: ContentReport[];
  status: ContentReportStatus | "all";
  page: number;
  pageSize: number;
  totalReports: number;
  totalPages: number;
}>;

export type CreateContentReportResult =
  | { ok: true; id: number }
  | { ok: false; reason: "invalid" | "limit" };

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type AccountRow = QueryResultRow & {
  status: string;
  role: string;
  username: string;
  display_name: string;
};
type TargetRow = QueryResultRow & { title: string };
type InsertRow = QueryResultRow & { id: string | number };
type ReportRow = QueryResultRow & {
  total_reports: string | number;
  total_pages: string | number;
  page: string | number;
  id: string | number | null;
  user_id: string | number | null;
  username: string | null;
  user_display_name: string | null;
  novel_id: number | null;
  media_id: string | number | null;
  original_article_id: string | number | null;
  target_title: string | null;
  target_slug: string | null;
  media_kind: string | null;
  category: string | null;
  details: string | null;
  status: string | null;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

const CATEGORIES = new Set<ContentReportCategory>([
  "title_error", "tag_error", "hotword_error", "playback_error", "spam", "other",
]);
const MEDIA_CATEGORIES = new Set<ContentReportCategory>(["title_error", "playback_error", "spam", "other"]);
const ORIGINAL_CATEGORIES = new Set<ContentReportCategory>(["title_error", "tag_error", "spam", "other"]);

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Invalid PostgreSQL " + label);
  return value;
}

function count(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid PostgreSQL " + label);
  return parsed;
}

function iso(value: Date | string | null, label: string): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL " + label);
  return parsed.toISOString();
}

function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function mapReport(row: ReportRow): ContentReport {
  const novelId = row.novel_id == null ? null : count(row.novel_id, "content report novel id");
  const mediaId = row.media_id == null ? null : count(row.media_id, "content report media id");
  const originalId = row.original_article_id == null ? null : count(row.original_article_id, "content report original id");
  const mediaKind = row.media_kind === "video" || row.media_kind === "audio" || row.media_kind === "file"
    ? row.media_kind
    : null;
  const category = CATEGORIES.has(row.category as ContentReportCategory)
    ? row.category as ContentReportCategory
    : "other";
  return {
    id: count(row.id ?? -1, "content report id"),
    userId: count(row.user_id ?? -1, "content report user id"),
    username: row.username ?? "",
    userDisplayName: row.user_display_name ?? "",
    targetType: mediaId ? "media" : originalId ? "original" : "novel",
    targetId: mediaId ?? originalId ?? novelId ?? 0,
    targetTitle: row.target_title ?? "已删除内容",
    targetSlug: row.target_slug,
    mediaKind,
    category,
    details: row.details ?? "",
    status: row.status === "resolved" ? "resolved" : "open",
    resolvedBy: row.resolved_by,
    resolvedAt: iso(row.resolved_at, "content report resolved time"),
    createdAt: iso(row.created_at, "content report creation time") ?? "",
    updatedAt: iso(row.updated_at, "content report update time") ?? "",
  };
}

export function isContentReportCategory(value: unknown): value is ContentReportCategory {
  return typeof value === "string" && CATEGORIES.has(value as ContentReportCategory);
}

export function isMediaReportCategory(value: unknown): value is ContentReportCategory {
  return typeof value === "string" && MEDIA_CATEGORIES.has(value as ContentReportCategory);
}

export function isOriginalReportCategory(value: unknown): value is ContentReportCategory {
  return typeof value === "string" && ORIGINAL_CATEGORIES.has(value as ContentReportCategory);
}

export async function createPostgresContentReport(
  params: {
    userId: number;
    novelId?: number | null;
    mediaId?: number | null;
    originalArticleId?: number | null;
    category: ContentReportCategory;
    details: string;
    dailyLimit: number;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<CreateContentReportResult> {
  const userId = Number(params.userId);
  const novelId = Number(params.novelId || 0);
  const mediaId = Number(params.mediaId || 0);
  const originalId = Number(params.originalArticleId || 0);
  const details = params.details.normalize("NFKC").trim();
  const dailyLimit = Math.min(Math.max(Math.floor(params.dailyLimit), 1), 500);
  const hasNovel = Number.isSafeInteger(novelId) && novelId > 0;
  const hasMedia = Number.isSafeInteger(mediaId) && mediaId > 0;
  const hasOriginal = Number.isSafeInteger(originalId) && originalId > 0;
  const targetCount = Number(hasNovel) + Number(hasMedia) + Number(hasOriginal);
  if (
    !Number.isSafeInteger(userId) || userId < 1 || targetCount !== 1 ||
    Array.from(details).length > 200 || !isContentReportCategory(params.category) ||
    (params.category === "other" && !details) ||
    (hasMedia && !isMediaReportCategory(params.category)) ||
    (hasOriginal && !isOriginalReportCategory(params.category))
  ) return { ok: false, reason: "invalid" };

  return transaction(async (tx) => {
    const accounts = await tx.query<AccountRow>({
      text: `SELECT status, role, username, display_name FROM users
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      values: [userId],
    });
    const account = accounts.rows[0];
    if (!account || account.status !== "active" || account.role !== "user") {
      return { ok: false, reason: "invalid" };
    }

    const targetQuery: SqlQuery = hasNovel
      ? { text: "SELECT title FROM novels WHERE id = $1", values: [novelId] }
      : hasMedia
        ? { text: "SELECT title FROM media_assets WHERE id = $1 AND kind IN ('video', 'audio')", values: [mediaId] }
        : { text: "SELECT title FROM original_articles WHERE id = $1 AND status = 'published'", values: [originalId] };
    const target = (await tx.query<TargetRow>(targetQuery)).rows[0];
    if (!target) return { ok: false, reason: "invalid" };

    const usage = await tx.query<QueryResultRow & { report_count: string | number }>({
      text: `SELECT COUNT(*) AS report_count FROM content_reports
        WHERE user_id = $1 AND created_at >= date_trunc('day', CURRENT_TIMESTAMP)
          AND created_at < date_trunc('day', CURRENT_TIMESTAMP) + INTERVAL '1 day'`,
      values: [userId],
    });
    if (count(usage.rows[0]?.report_count ?? 0, "daily content report count") >= dailyLimit) {
      return { ok: false, reason: "limit" };
    }

    const inserted = await tx.query<InsertRow>({
      text: `INSERT INTO content_reports
        (user_id, novel_id, media_id, original_article_id, category, details)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      values: [userId, hasNovel ? novelId : null, hasMedia ? mediaId : null, hasOriginal ? originalId : null, params.category, details],
    });
    const id = count(inserted.rows[0]?.id ?? -1, "inserted content report id");
    await queueReportNotification(tx, id, target.title, account, params.category, details);
    return { ok: true, id };
  });
}

async function queueReportNotification(
  executor: SqlExecutor,
  reportId: number,
  targetTitle: string,
  account: Pick<AccountRow, "username" | "display_name">,
  category: ContentReportCategory,
  details: string,
): Promise<void> {
  const telegram = getTelegramConfig();
  if (!telegram?.adminChatIds.length) return;
  const text = [
    `<b>内容反馈</b> · ${escapeHtml(targetTitle)}`,
    `${escapeHtml(account.display_name)} (@${escapeHtml(account.username)}) · ${escapeHtml(category)}`,
    details ? `\n${escapeHtml(details)}` : "",
  ].join("\n");
  for (const chatId of telegram.adminChatIds) {
    await executor.query({
      text: `INSERT INTO telegram_outbox
        (dedupe_key, method, payload_json, metadata_json, next_attempt_at)
        VALUES ($1, 'sendMessage', $2::jsonb, '{}'::jsonb, clock_timestamp())
        ON CONFLICT (dedupe_key) DO NOTHING`,
      values: [
        `report:${reportId}:${chatId}`,
        JSON.stringify({
          chat_id: chatId,
          text: text.slice(0, 4_000),
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      ],
    });
  }
}

export async function listPostgresContentReports(
  executor: SqlExecutor,
  params: { page?: number; pageSize?: number; status?: string } = {},
): Promise<ContentReportPage> {
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 30), 1), 100);
  const requestedPage = Math.max(Math.floor(Number(params.page || 1)) || 1, 1);
  const status: ContentReportPage["status"] = params.status === "resolved"
    ? "resolved"
    : params.status === "all" ? "all" : "open";
  const result = await executor.query<ReportRow>({
    text: `WITH filtered AS MATERIALIZED (
        SELECT * FROM content_reports WHERE ($1::text = 'all' OR status = $1)
      ), stats AS (
        SELECT COUNT(*)::bigint AS total_reports,
          GREATEST(1, CEIL(COUNT(*)::numeric / $2::integer))::bigint AS total_pages
        FROM filtered
      ), bounds AS (
        SELECT LEAST($3::bigint, total_pages)::bigint AS page FROM stats
      ), page_rows AS (
        SELECT * FROM filtered
        ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC, id DESC
        LIMIT $2 OFFSET ((SELECT page FROM bounds) - 1) * $2
      )
      SELECT stats.total_reports, stats.total_pages, bounds.page,
        report.id, report.user_id, account.username, account.display_name AS user_display_name,
        report.novel_id, report.media_id, report.original_article_id,
        COALESCE(novel.title, media.title, original.title, '已删除内容') AS target_title,
        original.slug AS target_slug, media.kind AS media_kind, report.category, report.details,
        report.status, report.resolved_by, report.resolved_at, report.created_at, report.updated_at
      FROM stats CROSS JOIN bounds
      LEFT JOIN page_rows report ON TRUE
      LEFT JOIN users account ON account.id = report.user_id
      LEFT JOIN novels novel ON novel.id = report.novel_id
      LEFT JOIN media_assets media ON media.id = report.media_id
      LEFT JOIN original_articles original ON original.id = report.original_article_id
      ORDER BY CASE report.status WHEN 'open' THEN 0 ELSE 1 END, report.created_at DESC, report.id DESC`,
    values: [status, pageSize, requestedPage],
  });
  const metadata = result.rows[0];
  const totalReports = count(metadata?.total_reports ?? 0, "content report total");
  const totalPages = Math.max(count(metadata?.total_pages ?? 1, "content report pages"), 1);
  const page = Math.min(Math.max(count(metadata?.page ?? 1, "content report page"), 1), totalPages);
  return {
    reports: result.rows.filter((row) => row.id != null).map(mapReport),
    status,
    page,
    pageSize,
    totalReports,
    totalPages,
  };
}

export async function setPostgresContentReportStatus(
  executor: SqlExecutor,
  idValue: number,
  status: ContentReportStatus,
  resolvedByValue: string,
): Promise<boolean> {
  const id = positiveId(idValue, "content report id");
  const resolvedBy = Array.from(resolvedByValue.normalize("NFKC").trim()).slice(0, 64).join("");
  const result = await executor.query({
    text: status === "resolved"
      ? `UPDATE content_reports SET status = 'resolved', resolved_by = $2,
          resolved_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1`
      : `UPDATE content_reports SET status = 'open', resolved_by = NULL,
          resolved_at = NULL, updated_at = clock_timestamp() WHERE id = $1`,
    values: status === "resolved" ? [id, resolvedBy] : [id],
  });
  return (result.rowCount ?? 0) > 0;
}

export async function deletePostgresContentReport(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM content_reports WHERE id = $1",
    values: [positiveId(idValue, "content report id")],
  });
  return (result.rowCount ?? 0) > 0;
}
