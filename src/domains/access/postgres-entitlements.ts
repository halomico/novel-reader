import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import {
  ENTITLEMENT_TARGET_RIGHTS,
  isEntitlementTargetType,
  type EntitlementDefinition,
  type EntitlementRight,
  type EntitlementTargetOption,
  type EntitlementTargetType,
} from "@/lib/entitlement-protocol";

export type PostgresUserEntitlementItem = Readonly<{
  id: number;
  userId: number;
  targetType: EntitlementTargetType;
  targetId: string;
  targetLabel: string;
  targetMeta: string;
  rights: EntitlementRight[];
  sourceOrderId: number | null;
  sourceLabel: string;
  grantedBy: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  active: boolean;
}>;
export type PostgresUserEntitlementPage = Readonly<{
  items: PostgresUserEntitlementItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;
type EntitlementRow = QueryResultRow & {
  total_items: string | number;
  total_pages: string | number;
  page: string | number;
  id: string | number | null;
  user_id: string | number | null;
  resource_type: string | null;
  resource_id: string | null;
  rights: unknown;
  source_order_id: string | number | null;
  source_label: string | null;
  granted_by: string | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
  expires_at: Date | string | null;
  active: boolean | null;
  target_label: string | null;
  target_meta: string | null;
};

const MEDIA_FOLDER_SQL = `regexp_replace(substr(media.stored_name, length(media.kind) + 2), '(^|/)[^/]+$', '')`;

function positiveId(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return value;
}

function count(value: string | number, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return date.toISOString();
}

function targetType(value: string): EntitlementTargetType {
  if (!isEntitlementTargetType(value)) throw new Error("Invalid PostgreSQL entitlement target type");
  return value;
}

export function parsePostgresEntitlementRights(value: unknown): EntitlementRight[] {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(parsed) ? [...new Set(parsed.filter((right): right is EntitlementRight =>
    right === "read" || right === "play" || right === "view" || right === "download"))] : [];
}

function rowToEntitlement(row: EntitlementRow): PostgresUserEntitlementItem {
  if (row.id === null || row.user_id === null || row.resource_type === null || row.resource_id === null ||
      row.granted_by === null || row.created_at === null || row.updated_at === null || row.active === null) {
    throw new Error("Incomplete PostgreSQL entitlement row");
  }
  return {
    id: positiveId(Number(row.id), "entitlement id"), userId: positiveId(Number(row.user_id), "entitlement user id"),
    targetType: targetType(row.resource_type), targetId: row.resource_id,
    targetLabel: row.target_label || "资源已移除", targetMeta: row.target_meta || `${row.resource_type}:${row.resource_id}`,
    rights: parsePostgresEntitlementRights(row.rights),
    sourceOrderId: row.source_order_id === null ? null : positiveId(Number(row.source_order_id), "entitlement order id"),
    sourceLabel: row.source_label || (row.granted_by ? `管理员 ${row.granted_by}` : "系统授予"), grantedBy: row.granted_by,
    createdAt: timestamp(row.created_at, "entitlement created timestamp")!, updatedAt: timestamp(row.updated_at, "entitlement updated timestamp")!,
    expiresAt: timestamp(row.expires_at, "entitlement expiry"), active: row.active === true,
  };
}

export async function listPostgresUserEntitlementsPage(
  executor: SqlExecutor,
  userIdValue: number,
  options: { page?: number; pageSize?: number } = {},
): Promise<PostgresUserEntitlementPage> {
  const userId = positiveId(userIdValue, "user id");
  const pageSize = Number.isFinite(options.pageSize) ? Math.min(Math.max(Math.floor(options.pageSize ?? 20), 1), 100) : 20;
  const requestedPage = Number.isFinite(options.page) ? Math.max(Math.floor(options.page ?? 1), 1) : 1;
  const result = await executor.query<EntitlementRow>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items, GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages
        FROM user_entitlements WHERE user_id = $1
      ), requested AS (
        SELECT total_items, total_pages, LEAST($2::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.total_items, requested.total_pages, requested.page, item.*
      FROM requested LEFT JOIN LATERAL (
        SELECT entitlement.id, entitlement.user_id, entitlement.resource_type, entitlement.resource_id, entitlement.rights,
          entitlement.source_order_id, orders.product_title AS source_label, entitlement.granted_by,
          entitlement.created_at, entitlement.updated_at, entitlement.expires_at,
          (entitlement.expires_at IS NULL OR entitlement.expires_at > clock_timestamp()) AS active,
          CASE entitlement.resource_type
            WHEN 'novel' THEN novel.title WHEN 'novel_source' THEN source.name
            WHEN 'video_category' THEN category.name WHEN 'video_tag' THEN video_tag.name
            WHEN 'video' THEN media.title WHEN 'audio' THEN media.title WHEN 'file' THEN media.title
            WHEN 'audio_folder' THEN CASE WHEN entitlement.resource_id = '/' THEN '根目录' ELSE entitlement.resource_id END
            WHEN 'file_folder' THEN CASE WHEN entitlement.resource_id = '/' THEN '根目录' ELSE entitlement.resource_id END
          END AS target_label,
          CASE entitlement.resource_type
            WHEN 'novel' THEN COALESCE(source.name, '默认来源')
            WHEN 'novel_source' THEN (SELECT COUNT(*)::text || ' 本小说' FROM novels WHERE source_id = source.id)
            WHEN 'video_category' THEN (SELECT COUNT(*)::text || ' 个视频' FROM media_assets WHERE category_id = category.id AND kind = 'video')
            WHEN 'video_tag' THEN (SELECT COUNT(*)::text || ' 个视频' FROM media_asset_tags WHERE tag_id = video_tag.id)
            WHEN 'video' THEN media.file_name WHEN 'audio' THEN media.file_name WHEN 'file' THEN media.file_name
            WHEN 'audio_folder' THEN '音频目录' WHEN 'file_folder' THEN '文件目录'
          END AS target_meta
        FROM user_entitlements entitlement
        LEFT JOIN market_orders orders ON orders.id = entitlement.source_order_id
        LEFT JOIN novels novel ON entitlement.resource_type = 'novel' AND novel.id::text = entitlement.resource_id
        LEFT JOIN novel_sources source ON (entitlement.resource_type = 'novel_source' AND source.id::text = entitlement.resource_id) OR source.id = novel.source_id
        LEFT JOIN video_categories category ON entitlement.resource_type = 'video_category' AND category.id::text = entitlement.resource_id
        LEFT JOIN video_tags video_tag ON entitlement.resource_type = 'video_tag' AND video_tag.id::text = entitlement.resource_id
        LEFT JOIN media_assets media ON entitlement.resource_type IN ('video', 'audio', 'file') AND media.id::text = entitlement.resource_id
        WHERE entitlement.user_id = $1
        ORDER BY active DESC, COALESCE(entitlement.expires_at, 'infinity'::timestamptz), entitlement.id DESC
        LIMIT $3 OFFSET ((requested.page - 1) * $3)
      ) item ON TRUE`,
    values: [userId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL entitlement page metadata is missing");
  return {
    items: result.rows.flatMap((row) => row.id === null ? [] : [rowToEntitlement(row)]),
    page: count(first.page, "entitlement page"), pageSize,
    totalItems: count(first.total_items, "entitlement total"), totalPages: count(first.total_pages, "entitlement pages"),
  };
}

export async function postgresEntitlementTargetExists(executor: SqlExecutor, definition: EntitlementDefinition): Promise<boolean> {
  return Boolean(await getPostgresEntitlementTargetOption(executor, definition.targetType, definition.targetId));
}

export async function grantPostgresUserEntitlement(
  input: { userId: number; definition: EntitlementDefinition; sourceOrderId?: number | null; grantedAt?: Date; grantedBy?: string },
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<boolean> {
  const userId = positiveId(input.userId, "user id");
  const grantedAt = input.grantedAt ?? new Date();
  const definition = input.definition;
  return transaction(async (tx) => {
    if (!await postgresEntitlementTargetExists(tx, definition)) return false;
    const result = await tx.query({
      text: `INSERT INTO user_entitlements
        (user_id, resource_type, resource_id, rights, source_order_id, granted_by, expires_at, created_at, updated_at)
        SELECT account.id, $2, $3, $4::jsonb, $5, $6,
          CASE WHEN $7::integer IS NULL THEN NULL ELSE $8::timestamptz + ($7 * interval '1 second') END,
          $8, clock_timestamp()
        FROM users account WHERE account.id = $1 AND account.deleted_at IS NULL
        ON CONFLICT (user_id, resource_type, resource_id) DO UPDATE SET
          rights = CASE WHEN user_entitlements.expires_at IS NULL OR user_entitlements.expires_at > $8
            THEN (SELECT COALESCE(jsonb_agg(DISTINCT right_name.value), '[]'::jsonb)
              FROM jsonb_array_elements_text(user_entitlements.rights || EXCLUDED.rights) AS right_name(value))
            ELSE EXCLUDED.rights END,
          source_order_id = COALESCE(EXCLUDED.source_order_id, user_entitlements.source_order_id),
          granted_by = COALESCE(NULLIF(EXCLUDED.granted_by, ''), user_entitlements.granted_by),
          expires_at = CASE
            WHEN user_entitlements.expires_at IS NULL THEN NULL
            WHEN user_entitlements.expires_at > $8 AND EXCLUDED.expires_at IS NULL THEN NULL
            WHEN user_entitlements.expires_at > $8
              THEN GREATEST(user_entitlements.expires_at, EXCLUDED.expires_at)
            ELSE EXCLUDED.expires_at
          END,
          updated_at = clock_timestamp()`,
      values: [userId, definition.targetType, definition.targetId, JSON.stringify(definition.rights), input.sourceOrderId ?? null,
        Array.from(input.grantedBy?.trim() ?? "").slice(0, 80).join(""), definition.durationSeconds, grantedAt],
    });
    return result.rowCount === 1;
  });
}

export async function updatePostgresUserEntitlement(executor: SqlExecutor, input: {
  id: number; userId: number; rights: readonly string[]; expiresAt: string | null | undefined; grantedBy?: string;
}): Promise<boolean> {
  const current = await executor.query<QueryResultRow & { resource_type: string; expires_at: Date | string | null }>({
    text: "SELECT resource_type, expires_at FROM user_entitlements WHERE id = $1 AND user_id = $2",
    values: [positiveId(input.id, "entitlement id"), positiveId(input.userId, "user id")],
  });
  const row = current.rows[0];
  if (!row) return false;
  const type = targetType(row.resource_type);
  const allowed = new Set(ENTITLEMENT_TARGET_RIGHTS[type]);
  const rights = [...new Set(input.rights.filter((right): right is EntitlementRight => allowed.has(right as EntitlementRight)))];
  if (!rights.length) return false;
  const expiresAt = input.expiresAt === undefined
    ? timestamp(row.expires_at, "entitlement expiry")
    : input.expiresAt && Number.isFinite(Date.parse(input.expiresAt)) ? new Date(input.expiresAt).toISOString() : null;
  const result = await executor.query({
    text: `UPDATE user_entitlements SET rights = $3::jsonb, expires_at = $4,
      granted_by = $5, updated_at = clock_timestamp() WHERE id = $1 AND user_id = $2`,
    values: [input.id, input.userId, JSON.stringify(rights), expiresAt, Array.from(input.grantedBy?.trim() ?? "").slice(0, 80).join("")],
  });
  return result.rowCount === 1;
}

export async function revokePostgresUserEntitlement(executor: SqlExecutor, idValue: number, userIdValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "DELETE FROM user_entitlements WHERE id = $1 AND user_id = $2",
    values: [positiveId(idValue, "entitlement id"), positiveId(userIdValue, "user id")],
  });
  return result.rowCount === 1;
}

function normalizedTargetId(value: string): string {
  if (!value.isWellFormed() || value.includes("\0")) return "";
  return Array.from(value.trim()).slice(0, 240).join("");
}

function targetQuery(type: EntitlementTargetType, exact: boolean): { text: string; kind?: "video" | "audio" | "file" } {
  const parameter = type === "audio_folder" || type === "file_folder" || type === "video" || type === "audio" || type === "file"
    ? "$2"
    : "$1";
  const filter = exact ? `= ${parameter}` : `ILIKE '%' || ${parameter} || '%'`;
  if (type === "novel") return { text: `SELECT novel.id::text AS id, novel.title AS label, COALESCE(source.name, '默认来源') AS meta FROM novels novel LEFT JOIN novel_sources source ON source.id = novel.source_id WHERE novel.${exact ? "id::text" : "title"} ${filter}` };
  if (type === "novel_source") return { text: `SELECT source.id::text AS id, source.name AS label, COUNT(novel.id)::text || ' 本小说' AS meta FROM novel_sources source LEFT JOIN novels novel ON novel.source_id = source.id WHERE source.${exact ? "id::text" : "name"} ${filter} GROUP BY source.id` };
  if (type === "video_category") return { text: `SELECT category.id::text AS id, category.name AS label, COUNT(media.id)::text || ' 个视频' AS meta FROM video_categories category LEFT JOIN media_assets media ON media.category_id = category.id AND media.kind = 'video' WHERE category.${exact ? "id::text" : "name"} ${filter} GROUP BY category.id` };
  if (type === "video_tag") return { text: `SELECT tag.id::text AS id, tag.name AS label, COUNT(relation.media_id)::text || ' 个视频' AS meta FROM video_tags tag LEFT JOIN media_asset_tags relation ON relation.tag_id = tag.id WHERE tag.${exact ? "id::text" : "name"} ${filter} GROUP BY tag.id` };
  if (type === "audio_folder" || type === "file_folder") {
    const kind = type === "audio_folder" ? "audio" : "file";
    const folderFilter = exact ? "folder = CASE WHEN $2 = '/' THEN '' ELSE $2 END" : "folder ILIKE '%' || $2 || '%'";
    return { kind, text: `SELECT CASE WHEN folder = '' THEN '/' ELSE folder END AS id, CASE WHEN folder = '' THEN '根目录' ELSE folder END AS label, COUNT(*)::text || ' 项' AS meta FROM (SELECT ${MEDIA_FOLDER_SQL} AS folder FROM media_assets media WHERE media.kind = $1) folders WHERE ${folderFilter} GROUP BY folder` };
  }
  const kind = type === "video" ? "video" : type === "audio" ? "audio" : "file";
  const mediaFilter = exact ? "media.id::text = $2" : "(media.title ILIKE '%' || $2 || '%' OR media.file_name ILIKE '%' || $2 || '%')";
  return { kind, text: `SELECT media.id::text AS id, media.title AS label, CASE WHEN ${MEDIA_FOLDER_SQL} = '' THEN media.file_name ELSE ${MEDIA_FOLDER_SQL} || ' / ' || media.file_name END AS meta FROM media_assets media WHERE media.kind = $1 AND ${mediaFilter}` };
}

export async function listPostgresEntitlementTargets(
  executor: SqlExecutor, type: EntitlementTargetType, queryValue = "", limit = 30,
): Promise<EntitlementTargetOption[]> {
  const query = Array.from(queryValue.normalize("NFKC").trim()).slice(0, 80).join("");
  const size = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 50) : 30;
  const statement = targetQuery(type, false);
  const values = statement.kind ? [statement.kind, query, size] : [query, size];
  const result = await executor.query<QueryResultRow & EntitlementTargetOption>({
    text: `${statement.text} ORDER BY lower(label), id LIMIT $${statement.kind ? 3 : 2}`, values,
  });
  return result.rows.map((row) => ({ id: row.id, label: row.label, meta: row.meta }));
}

export async function getPostgresEntitlementTargetOption(
  executor: SqlExecutor, type: EntitlementTargetType, targetIdValue: string,
): Promise<EntitlementTargetOption | null> {
  const id = normalizedTargetId(targetIdValue);
  if (!id) return null;
  const statement = targetQuery(type, true);
  const result = await executor.query<QueryResultRow & EntitlementTargetOption>({
    text: `${statement.text} LIMIT 1`, values: statement.kind ? [statement.kind, id] : [id],
  });
  const row = result.rows[0];
  return row ? { id: row.id, label: row.label, meta: row.meta } : null;
}
