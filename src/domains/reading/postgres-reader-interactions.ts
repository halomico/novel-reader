import type { QueryResultRow } from "pg";
import { requestAnalyticsMetadata } from "@/core/analytics/request-metadata";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import type { HeaderReader } from "@/core/security/client-ip";
import { validateEngagementEventId } from "@/core/engagement/record";

export type PostgresGroveStage = "seed" | "sprout" | "tree";

export type PostgresNovelInteractionState = Readonly<{
  exists: boolean;
  favorite: boolean;
  planted: boolean;
  visitCount: number;
  stage: PostgresGroveStage;
}>;

export type PostgresNovelUnlockResult =
  | { ok: true; charged: boolean; sodaBalance: number }
  | { ok: false; reason: "not_found" | "account_unavailable" | "insufficient_soda" };

export type PostgresNovelEngagementResult = Readonly<{
  accepted: boolean;
  counted: boolean;
  duplicateEvent: boolean;
}>;

export type PostgresFavoriteNovel = Readonly<{
  id: number;
  title: string;
  storageMode: "single" | "chapters";
  chapterCount: number;
  sodaPrice: number;
  wordCount: number;
  mtimeMs: number;
  updatedAt: string;
}>;

export type PostgresFavoriteNovelPage = Readonly<{
  items: PostgresFavoriteNovel[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

type InteractionRow = QueryResultRow & {
  exists: boolean;
  favorite: boolean;
  visit_count: string | number | null;
};

type UserRow = QueryResultRow & {
  status: string;
  role: string;
  soda_balance: string | number;
};

type UnlockNovelRow = QueryResultRow & {
  source_id: number | null;
  access_mode: string;
  soda_price: number;
};

type FavoriteNovelRow = QueryResultRow & {
  total_items: string | number;
  total_pages: string | number;
  page: string | number;
  id: number | null;
  title: string | null;
  storage_mode: "single" | "chapters" | null;
  chapter_count: number | null;
  soda_price: number | null;
  word_count: number | null;
  mtime_ms: string | number | null;
  updated_at: Date | string | null;
};

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function safeCount(value: string | number | null | undefined, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function boundedPage(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function boundedPageSize(value: number): number {
  return Number.isSafeInteger(value) ? Math.min(Math.max(value, 1), 100) : 20;
}

function isoTimestamp(value: Date | string | null, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed.toISOString();
}

function normalizeNovelIds(values: readonly number[]): number[] {
  if (values.length > 500) throw new TypeError("A favorite batch cannot exceed 500 novels");
  const unique = new Set<number>();
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new TypeError("Invalid PostgreSQL favorite novel id");
    }
    unique.add(value);
  }
  return [...unique];
}

function boundedText(value: string | null | undefined, maximum: number): string {
  if (typeof value !== "string") return "";
  if (!value.isWellFormed() || value.includes("\0")) throw new TypeError("Invalid reader telemetry text");
  return Array.from(value.trim()).slice(0, maximum).join("");
}

export function postgresGroveStage(value: number): PostgresGroveStage {
  const visits = Math.max(Math.floor(Number.isFinite(value) ? value : 0), 0);
  return visits >= 10 ? "tree" : visits >= 3 ? "sprout" : "seed";
}

function interactionState(row: InteractionRow | undefined): PostgresNovelInteractionState {
  const visitCount = safeCount(row?.visit_count, "novel grove visit count");
  return {
    exists: row?.exists === true,
    favorite: row?.favorite === true,
    planted: row?.visit_count !== null && row?.visit_count !== undefined,
    visitCount,
    stage: postgresGroveStage(visitCount),
  };
}

export async function getPostgresNovelInteractionState(
  executor: SqlExecutor,
  userIdValue: number,
  novelIdValue: number,
): Promise<PostgresNovelInteractionState> {
  const userId = positiveId(userIdValue, "user id");
  const novelId = positiveId(novelIdValue, "novel id");
  const result = await executor.query<InteractionRow>({
    name: "reading-novel-interaction-state-v1",
    text: `SELECT
      EXISTS (SELECT 1 FROM novels WHERE id = $2) AS exists,
      EXISTS (SELECT 1 FROM user_novel_favorites WHERE user_id = $1 AND novel_id = $2) AS favorite,
      (SELECT visit_count FROM user_novel_grove WHERE user_id = $1 AND novel_id = $2) AS visit_count`,
    values: [userId, novelId],
  });
  return interactionState(result.rows[0]);
}

async function lockInteraction(
  transaction: SqlExecutor,
  kind: "favorite" | "grove",
  userId: number,
  novelId: number,
): Promise<void> {
  await transaction.query({
    text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    values: [`novel-${kind}:${userId}:${novelId}`],
  });
}

export async function togglePostgresNovelFavorite(
  userIdValue: number,
  novelIdValue: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<{ ok: boolean; favorite: boolean }> {
  const userId = positiveId(userIdValue, "user id");
  const novelId = positiveId(novelIdValue, "novel id");
  return transaction(async (tx) => {
    await lockInteraction(tx, "favorite", userId, novelId);
    const removed = await tx.query({
      text: "DELETE FROM user_novel_favorites WHERE user_id = $1 AND novel_id = $2",
      values: [userId, novelId],
    });
    if (removed.rowCount) return { ok: true, favorite: false };
    const added = await tx.query({
      text: `INSERT INTO user_novel_favorites (user_id, novel_id)
        SELECT $1, n.id FROM novels n
        JOIN users u ON u.id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE n.id = $2
        ON CONFLICT (user_id, novel_id) DO NOTHING`,
      values: [userId, novelId],
    });
    return { ok: added.rowCount === 1, favorite: added.rowCount === 1 };
  });
}

export async function removePostgresNovelFavorites(
  executor: SqlExecutor,
  userIdValue: number,
  novelIds: readonly number[],
): Promise<number> {
  const userId = positiveId(userIdValue, "user id");
  const ids = normalizeNovelIds(novelIds);
  if (!ids.length) return 0;
  const result = await executor.query({
    name: "reading-remove-novel-favorites-v1",
    text: `DELETE FROM user_novel_favorites
      WHERE user_id = $1 AND novel_id = ANY($2::integer[])`,
    values: [userId, ids],
  });
  return result.rowCount ?? 0;
}

export async function listPostgresNovelFavoritesPage(
  executor: SqlExecutor,
  userIdValue: number,
  options: { page?: number; pageSize?: number } = {},
): Promise<PostgresFavoriteNovelPage> {
  const userId = positiveId(userIdValue, "user id");
  const requestedPage = boundedPage(options.page ?? 1);
  const pageSize = boundedPageSize(options.pageSize ?? 20);
  const result = await executor.query<FavoriteNovelRow>({
    name: "reading-list-novel-favorites-page-v1",
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items,
               GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages
        FROM user_novel_favorites f
        INNER JOIN novels n ON n.id = f.novel_id
        WHERE f.user_id = $1
      ), requested AS (
        SELECT total_items, total_pages,
               LEAST(GREATEST($2::bigint, 1), total_pages) AS page
        FROM page_info
      )
      SELECT requested.total_items, requested.total_pages, requested.page,
             page_rows.id, page_rows.title, page_rows.storage_mode,
             page_rows.chapter_count, page_rows.soda_price, page_rows.word_count,
             page_rows.mtime_ms, page_rows.updated_at
      FROM requested
      LEFT JOIN LATERAL (
        SELECT n.id, n.title, n.storage_mode, n.chapter_count, n.soda_price,
               n.word_count, n.mtime_ms, n.updated_at
        FROM user_novel_favorites f
        INNER JOIN novels n ON n.id = f.novel_id
        WHERE f.user_id = $1
        ORDER BY f.created_at DESC, f.novel_id DESC
        LIMIT $3::integer
        OFFSET ((requested.page - 1) * $3::integer)
      ) page_rows ON TRUE
      ORDER BY page_rows.id IS NULL ASC`,
    values: [userId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL favorite page metadata is missing");
  const items = result.rows.flatMap((row): PostgresFavoriteNovel[] => {
    if (row.id === null) return [];
    if (row.title === null || row.storage_mode === null || row.chapter_count === null ||
        row.soda_price === null || row.word_count === null || row.mtime_ms === null) {
      throw new Error("PostgreSQL favorite novel row is incomplete");
    }
    return [{
      id: positiveId(row.id, "favorite novel id"),
      title: row.title,
      storageMode: row.storage_mode,
      chapterCount: safeCount(row.chapter_count, "favorite novel chapter count"),
      sodaPrice: safeCount(row.soda_price, "favorite novel soda price"),
      wordCount: safeCount(row.word_count, "favorite novel word count"),
      mtimeMs: safeCount(row.mtime_ms, "favorite novel modification time"),
      updatedAt: isoTimestamp(row.updated_at, "favorite novel update timestamp"),
    }];
  });
  return {
    items,
    page: safeCount(first.page, "favorite page"),
    pageSize,
    totalItems: safeCount(first.total_items, "favorite total items"),
    totalPages: safeCount(first.total_pages, "favorite total pages"),
  };
}

export async function togglePostgresNovelGrove(
  userIdValue: number,
  novelIdValue: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<{ ok: boolean } & Omit<PostgresNovelInteractionState, "exists" | "favorite">> {
  const userId = positiveId(userIdValue, "user id");
  const novelId = positiveId(novelIdValue, "novel id");
  return transaction(async (tx) => {
    await lockInteraction(tx, "grove", userId, novelId);
    const removed = await tx.query({
      text: "DELETE FROM user_novel_grove WHERE user_id = $1 AND novel_id = $2",
      values: [userId, novelId],
    });
    if (removed.rowCount) {
      return { ok: true, planted: false, visitCount: 0, stage: "seed" };
    }
    const added = await tx.query<QueryResultRow & { visit_count: string | number }>({
      text: `INSERT INTO user_novel_grove (user_id, novel_id, visit_count)
        SELECT $1, n.id, 0 FROM novels n
        JOIN users u ON u.id = $1 AND u.status = 'active' AND u.deleted_at IS NULL
        WHERE n.id = $2
        ON CONFLICT (user_id, novel_id) DO NOTHING
        RETURNING visit_count`,
      values: [userId, novelId],
    });
    const row = added.rows[0];
    return row
      ? { ok: true, planted: true, visitCount: safeCount(row.visit_count, "novel grove visit count"), stage: "seed" }
      : { ok: false, planted: false, visitCount: 0, stage: "seed" };
  });
}

export async function unlockPostgresNovelWithSoda(
  userIdValue: number,
  novelIdValue: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresNovelUnlockResult> {
  const userId = positiveId(userIdValue, "user id");
  const novelId = positiveId(novelIdValue, "novel id");
  return transaction(async (tx) => {
    const users = await tx.query<UserRow>({
      text: `SELECT status, role, soda_balance FROM users
        WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      values: [userId],
    });
    const user = users.rows[0];
    if (!user || user.status !== "active") return { ok: false, reason: "account_unavailable" };

    const novels = await tx.query<UnlockNovelRow>({
      text: "SELECT source_id, access_mode, soda_price FROM novels WHERE id = $1 FOR KEY SHARE",
      values: [novelId],
    });
    const novel = novels.rows[0];
    if (!novel) return { ok: false, reason: "not_found" };
    const currentBalance = safeCount(user.soda_balance, "soda balance");
    const price = safeCount(novel.soda_price, "novel soda price");
    if (user.role === "admin" || novel.access_mode !== "soda" || price === 0) {
      return { ok: true, charged: false, sodaBalance: currentBalance };
    }

    const entitlement = await tx.query<QueryResultRow & { allowed: boolean }>({
      text: `SELECT EXISTS (
        SELECT 1 FROM user_entitlements e
        WHERE e.user_id = $1
          AND (e.expires_at IS NULL OR e.expires_at > clock_timestamp())
          AND e.rights ? 'read'
          AND ((e.resource_type = 'novel' AND e.resource_id = $2)
            OR ($3::integer IS NOT NULL AND e.resource_type = 'novel_source' AND e.resource_id = $3::text))
      ) AS allowed`,
      values: [userId, String(novelId), novel.source_id],
    });
    if (entitlement.rows[0]?.allowed === true) {
      return { ok: true, charged: false, sodaBalance: currentBalance };
    }

    const charged = await tx.query<QueryResultRow & { soda_balance: string | number }>({
      text: `UPDATE users SET soda_balance = soda_balance - $2, updated_at = clock_timestamp()
        WHERE id = $1 AND soda_balance >= $2 RETURNING soda_balance`,
      values: [userId, price],
    });
    const balanceRow = charged.rows[0];
    if (!balanceRow) return { ok: false, reason: "insufficient_soda" };
    const sodaBalance = safeCount(balanceRow.soda_balance, "soda balance");

    await tx.query({
      text: `INSERT INTO user_entitlements
        (user_id, resource_type, resource_id, rights, granted_by, created_at, updated_at)
        VALUES ($1, 'novel', $2, jsonb_build_array('read'), 'novel_unlock', clock_timestamp(), clock_timestamp())
        ON CONFLICT (user_id, resource_type, resource_id) DO UPDATE SET
          rights = CASE WHEN user_entitlements.rights ? 'read'
            THEN user_entitlements.rights ELSE user_entitlements.rights || jsonb_build_array('read') END,
          updated_at = clock_timestamp(), expires_at = NULL`,
      values: [userId, String(novelId)],
    });
    await tx.query({
      text: `INSERT INTO user_currency_transactions
        (user_id, currency, amount, balance_after, source, reference_key, note)
        VALUES ($1, 'soda', $2, $3, 'novel_unlock', $4, '小说永久阅读权限')`,
      values: [userId, -price, sodaBalance, `novel-unlock:${userId}:${novelId}`],
    });
    return { ok: true, charged: true, sodaBalance };
  });
}

export async function recordPostgresNovelView(
  input: {
    eventId: unknown;
    viewerKey: string;
    novelId: number;
    userId?: number | null;
    headers: HeaderReader;
    referrer?: string | null;
    analyticsEnabled?: boolean;
    dedupeWindowMs?: number;
  },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<PostgresNovelEngagementResult> {
  const eventId = validateEngagementEventId(input.eventId);
  if (!eventId) throw new TypeError("Invalid PostgreSQL engagement event id");
  const novelId = positiveId(input.novelId, "novel id");
  const userId = input.userId == null ? null : positiveId(input.userId, "user id");
  const viewerKey = boundedText(input.viewerKey, 100);
  if (!viewerKey) throw new TypeError("Invalid PostgreSQL engagement viewer");
  const windowMs = Math.min(Math.max(Math.floor(input.dedupeWindowMs ?? 30 * 60_000), 10_000), 86_400_000);
  const metadata = requestAnalyticsMetadata(input.headers, input.referrer);

  return transaction(async (tx) => {
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      values: [`engagement:${eventId}`],
    });
    const existing = await tx.query<QueryResultRow & { counted: boolean }>({
      text: "SELECT counted FROM engagement_events WHERE event_id = $1",
      values: [eventId],
    });
    if (existing.rows[0]) {
      return { accepted: true, counted: existing.rows[0].counted === true, duplicateEvent: true };
    }
    const novel = await tx.query({
      text: "SELECT id FROM novels WHERE id = $1 FOR KEY SHARE",
      values: [novelId],
    });
    if (!novel.rowCount) return { accepted: false, counted: false, duplicateEvent: false };
    const recent = await tx.query<QueryResultRow & { found: boolean }>({
      text: `SELECT EXISTS (
        SELECT 1 FROM engagement_events
        WHERE viewer_key = $1 AND content_type = 'novel' AND content_id = $2
          AND action = 'detail_view' AND counted = TRUE
          AND created_at >= clock_timestamp() - ($3::double precision * interval '1 millisecond')
      ) AS found`,
      values: [viewerKey, novelId, windowMs],
    });
    const counted = recent.rows[0]?.found !== true;
    await tx.query({
      text: `INSERT INTO engagement_events
        (event_id, viewer_key, content_type, content_id, action, counted, created_at)
        VALUES ($1, $2, 'novel', $3, 'detail_view', $4, clock_timestamp())`,
      values: [eventId, viewerKey, novelId, counted],
    });
    // Grove growth represents a real return to planted content, while the public
    // visit counter deliberately keeps its longer anti-inflation window. A fresh
    // event id is still idempotent on transport retry because replay exits above.
    if (userId !== null) {
      await tx.query({
        text: `UPDATE user_novel_grove SET visit_count = visit_count + 1
          WHERE user_id = $1 AND novel_id = $2`,
        values: [userId, novelId],
      });
    }
    if (!counted) return { accepted: true, counted: false, duplicateEvent: false };

    await tx.query({
      text: `UPDATE novels SET visit_count = visit_count + 1,
        last_accessed_at = clock_timestamp(), last_accessed_ip = $2::inet,
        last_accessed_user_agent = $3 WHERE id = $1`,
      values: [novelId, metadata.ip === "unknown" ? null : metadata.ip, metadata.userAgent],
    });
    if (input.analyticsEnabled) {
      await tx.query({
        text: `INSERT INTO analytics_events
          (user_id, event_type, path, referrer, ip, country, user_agent, device, browser, os, novel_id)
          VALUES ($1, 'book_view', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        values: [userId, `/books/${novelId}`, metadata.referrer, metadata.ip, metadata.country, metadata.userAgent,
          metadata.device, metadata.browser, metadata.os, novelId],
      });
    }
    return { accepted: true, counted: true, duplicateEvent: false };
  });
}
