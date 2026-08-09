import type { DatabaseSync } from "node:sqlite";
import { getDb } from "./db";
import type { MediaAsset } from "./media";
import {
  ENTITLEMENT_TARGET_RIGHTS,
  type EntitlementDefinition,
  type EntitlementRight,
  type EntitlementTargetOption,
  type EntitlementTargetType,
} from "./entitlement-protocol";

export {
  decodeEntitlementDefinition,
  encodeEntitlementDefinition,
  ENTITLEMENT_TARGET_RIGHTS,
  ENTITLEMENT_TARGET_TYPES,
  isEntitlementTargetType,
  parseEntitlementDefinition,
  type EntitlementDefinition,
  type EntitlementRight,
  type EntitlementTargetOption,
  type EntitlementTargetType,
} from "./entitlement-protocol";

export function parseStoredRights(value: string): EntitlementRight[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((right): right is EntitlementRight => (
          right === "read" || right === "play" || right === "view" || right === "download"
        ))
      : [];
  } catch {
    return [];
  }
}

export function grantUserEntitlement(input: {
  userId: number;
  definition: EntitlementDefinition;
  sourceOrderId?: number | null;
  grantedAt?: number;
  grantedBy?: string;
  db?: DatabaseSync;
}) {
  const db = input.db || getDb();
  const existing = db.prepare(
    `SELECT rights, expires_at
     FROM user_entitlements
     WHERE user_id = ? AND resource_type = ? AND resource_id = ?`,
  ).get(input.userId, input.definition.targetType, input.definition.targetId) as {
    rights: string;
    expires_at: string | null;
  } | undefined;
  const grantedAt = input.grantedAt ?? Date.now();
  const existingActive = Boolean(
    existing && (existing.expires_at === null || Date.parse(existing.expires_at) > grantedAt),
  );
  const rights = Array.from(new Set([
    ...(existingActive ? parseStoredRights(existing?.rights || "[]") : []),
    ...input.definition.rights,
  ]));
  const requestedExpiry = input.definition.durationSeconds
    ? new Date(grantedAt + input.definition.durationSeconds * 1000).toISOString()
    : null;
  let expiresAt = requestedExpiry;
  if (existingActive && existing) {
    if (existing.expires_at === null || requestedExpiry === null) expiresAt = null;
    else expiresAt = Date.parse(existing.expires_at) > Date.parse(requestedExpiry) ? existing.expires_at : requestedExpiry;
  }
  db.prepare(
    `INSERT INTO user_entitlements (
       user_id, resource_type, resource_id, rights, source_order_id, granted_by, expires_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, resource_type, resource_id) DO UPDATE SET
       rights = excluded.rights,
       source_order_id = COALESCE(excluded.source_order_id, user_entitlements.source_order_id),
       granted_by = CASE WHEN excluded.granted_by <> '' THEN excluded.granted_by ELSE user_entitlements.granted_by END,
       expires_at = excluded.expires_at,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(
    input.userId,
    input.definition.targetType,
    input.definition.targetId,
    JSON.stringify(rights),
    input.sourceOrderId || null,
    String(input.grantedBy || "").slice(0, 80),
    expiresAt,
  );
}

export type UserEntitlementItem = {
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
};

export type UserEntitlementPage = {
  items: UserEntitlementItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

type UserEntitlementRow = {
  id: number;
  user_id: number;
  resource_type: EntitlementTargetType;
  resource_id: string;
  rights: string;
  source_order_id: number | null;
  source_label: string | null;
  granted_by: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  active: number;
};

function toUserEntitlement(row: UserEntitlementRow): UserEntitlementItem {
  const target = getEntitlementTargetOption(row.resource_type, row.resource_id);
  return {
    id: row.id,
    userId: row.user_id,
    targetType: row.resource_type,
    targetId: row.resource_id,
    targetLabel: target?.label || "资源已移除",
    targetMeta: target?.meta || `${row.resource_type}:${row.resource_id}`,
    rights: parseStoredRights(row.rights),
    sourceOrderId: row.source_order_id,
    sourceLabel: row.source_label || (row.granted_by ? `管理员 ${row.granted_by}` : "系统授予"),
    grantedBy: row.granted_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    active: Boolean(row.active),
  };
}

export function listUserEntitlementsPage(
  userId: number,
  options: { page?: number; pageSize?: number } = {},
): UserEntitlementPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 20), 1), 100);
  const totalItems = (db.prepare("SELECT COUNT(*) AS count FROM user_entitlements WHERE user_id = ?")
    .get(userId) as { count: number }).count;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const rows = db.prepare(
    `SELECT e.id, e.user_id, e.resource_type, e.resource_id, e.rights, e.source_order_id,
            o.product_title AS source_label, e.granted_by, e.created_at, e.updated_at, e.expires_at,
            CASE WHEN e.expires_at IS NULL OR datetime(e.expires_at) > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS active
     FROM user_entitlements e
     LEFT JOIN market_orders o ON o.id = e.source_order_id
     WHERE e.user_id = ?
     ORDER BY active DESC, COALESCE(e.expires_at, '9999-12-31') ASC, e.id DESC
     LIMIT ? OFFSET ?`,
  ).all(userId, pageSize, (page - 1) * pageSize) as UserEntitlementRow[];
  return { items: rows.map(toUserEntitlement), page, pageSize, totalItems, totalPages };
}

export function updateUserEntitlement(input: {
  id: number;
  userId: number;
  rights: readonly string[];
  expiresAt: string | null | undefined;
  grantedBy?: string;
}): boolean {
  const db = getDb();
  const row = db.prepare(
    "SELECT resource_type, expires_at FROM user_entitlements WHERE id = ? AND user_id = ?",
  ).get(input.id, input.userId) as { resource_type: EntitlementTargetType; expires_at?: string | null } | undefined;
  if (!row) return false;
  const allowed = new Set(ENTITLEMENT_TARGET_RIGHTS[row.resource_type]);
  const rights = Array.from(new Set(input.rights.filter(
    (right): right is EntitlementRight => allowed.has(right as EntitlementRight),
  )));
  if (!rights.length) return false;
  const expiresAt = input.expiresAt === undefined
    ? row.expires_at || null
    : input.expiresAt && Number.isFinite(Date.parse(input.expiresAt))
      ? new Date(input.expiresAt).toISOString()
      : null;
  return db.prepare(
    `UPDATE user_entitlements
     SET rights = ?, expires_at = ?, granted_by = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  ).run(
    JSON.stringify(rights),
    expiresAt,
    String(input.grantedBy || "").slice(0, 80),
    input.id,
    input.userId,
  ).changes > 0;
}

export function revokeUserEntitlement(id: number, userId: number): boolean {
  return getDb().prepare("DELETE FROM user_entitlements WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

export function hasUserEntitlement(
  userId: number,
  targets: Array<{ type: EntitlementTargetType; id: string }>,
  right: EntitlementRight,
): boolean {
  if (!targets.length) return false;
  const clauses = targets.map(() => "(resource_type = ? AND resource_id = ?)").join(" OR ");
  const values = targets.flatMap((target) => [target.type, target.id]);
  const rows = getDb().prepare(
    `SELECT rights
     FROM user_entitlements
     WHERE user_id = ?
       AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
       AND (${clauses})`,
  ).all(userId, ...values) as Array<{ rights: string }>;
  return rows.some((row) => parseStoredRights(row.rights).includes(right));
}

export function hasNovelReadEntitlement(userId: number, novelId: number, sourceId: number | null): boolean {
  return hasUserEntitlement(userId, [
    { type: "novel", id: String(novelId) },
    ...(sourceId ? [{ type: "novel_source" as const, id: String(sourceId) }] : []),
  ], "read");
}

export function hasMediaAssetEntitlement(
  userId: number,
  asset: Pick<MediaAsset, "id" | "kind" | "categoryId" | "folder">,
  right: EntitlementRight,
): boolean {
  const directType: EntitlementTargetType = asset.kind;
  const folderType: EntitlementTargetType | null = asset.kind === "audio"
    ? "audio_folder"
    : asset.kind === "file"
      ? "file_folder"
      : null;
  const rows = getDb().prepare(
    `SELECT e.rights
     FROM user_entitlements e
     WHERE e.user_id = ?
       AND (e.expires_at IS NULL OR datetime(e.expires_at) > CURRENT_TIMESTAMP)
       AND (
         (e.resource_type = ? AND e.resource_id = ?)
         OR (? = 'video' AND e.resource_type = 'video_category' AND e.resource_id = ?)
         OR (? = 'video' AND e.resource_type = 'video_tag' AND EXISTS (
           SELECT 1 FROM media_asset_tags mt
           WHERE mt.media_id = ? AND CAST(mt.tag_id AS TEXT) = e.resource_id
         ))
         OR (? <> '' AND e.resource_type = ? AND (
           e.resource_id = '/'
           OR e.resource_id = ?
           OR ? LIKE e.resource_id || '/%'
         ))
       )`,
  ).all(
    userId,
    directType,
    String(asset.id),
    asset.kind,
    String(asset.categoryId || ""),
    asset.kind,
    asset.id,
    folderType || "",
    folderType || "",
    asset.folder,
    asset.folder,
  ) as Array<{ rights: string }>;
  return rows.some((row) => parseStoredRights(row.rights).includes(right));
}

export function entitlementTargetExists(definition: EntitlementDefinition): boolean {
  const db = getDb();
  const numericId = Number(definition.targetId);
  if (definition.targetType === "novel") return Boolean(db.prepare("SELECT 1 FROM novels WHERE id = ?").get(numericId));
  if (definition.targetType === "novel_source") return Boolean(db.prepare("SELECT 1 FROM novel_sources WHERE id = ?").get(numericId));
  if (definition.targetType === "video") return Boolean(db.prepare("SELECT 1 FROM media_assets WHERE id = ? AND kind = 'video'").get(numericId));
  if (definition.targetType === "video_category") return Boolean(db.prepare("SELECT 1 FROM video_categories WHERE id = ?").get(numericId));
  if (definition.targetType === "video_tag") return Boolean(db.prepare("SELECT 1 FROM video_tags WHERE id = ?").get(numericId));
  if (definition.targetType === "audio") return Boolean(db.prepare("SELECT 1 FROM media_assets WHERE id = ? AND kind = 'audio'").get(numericId));
  if (definition.targetType === "file") return Boolean(db.prepare("SELECT 1 FROM media_assets WHERE id = ? AND kind = 'file'").get(numericId));
  const kind = definition.targetType === "audio_folder" ? "audio" : "file";
  const folder = definition.targetId === "/" ? "" : definition.targetId;
  return Boolean(db.prepare(
    `SELECT 1 FROM (
       SELECT ${MEDIA_FOLDER_SQL} AS media_folder
       FROM media_assets WHERE kind = ?
     ) WHERE media_folder = ? LIMIT 1`,
  ).get(kind, folder));
}

const MEDIA_FOLDER_SQL = `CASE
  WHEN stored_name = kind || '/' || file_name THEN ''
  ELSE substr(
    stored_name,
    length(kind) + 2,
    length(stored_name) - length(kind) - length(file_name) - 2
  )
END`;

function searchPattern(query: string): string {
  return `%${query.normalize("NFKC").trim().slice(0, 80)}%`;
}

export function listEntitlementTargets(
  targetType: EntitlementTargetType,
  query = "",
  limit = 30,
): EntitlementTargetOption[] {
  const db = getDb();
  const size = Math.min(Math.max(Math.floor(limit), 1), 50);
  const pattern = searchPattern(query);
  if (targetType === "novel") {
    return db.prepare(
      `SELECT CAST(n.id AS TEXT) AS id, n.title AS label,
              COALESCE(s.name, '默认来源') AS meta
       FROM novels n LEFT JOIN novel_sources s ON s.id = n.source_id
       WHERE ? = '%%' OR n.title LIKE ?
       ORDER BY n.title COLLATE NOCASE, n.id LIMIT ?`,
    ).all(pattern, pattern, size) as EntitlementTargetOption[];
  }
  if (targetType === "novel_source") {
    return db.prepare(
      `SELECT CAST(s.id AS TEXT) AS id, s.name AS label,
              CAST(COUNT(n.id) AS TEXT) || ' 本小说' AS meta
       FROM novel_sources s LEFT JOIN novels n ON n.source_id = s.id
       WHERE ? = '%%' OR s.name LIKE ?
       GROUP BY s.id ORDER BY s.sort_order, s.name COLLATE NOCASE LIMIT ?`,
    ).all(pattern, pattern, size) as EntitlementTargetOption[];
  }
  if (targetType === "video_category") {
    return db.prepare(
      `SELECT CAST(c.id AS TEXT) AS id, c.name AS label,
              CAST(COUNT(m.id) AS TEXT) || ' 个视频' AS meta
       FROM video_categories c LEFT JOIN media_assets m ON m.category_id = c.id AND m.kind = 'video'
       WHERE ? = '%%' OR c.name LIKE ?
       GROUP BY c.id ORDER BY c.sort_order, c.name COLLATE NOCASE LIMIT ?`,
    ).all(pattern, pattern, size) as EntitlementTargetOption[];
  }
  if (targetType === "video_tag") {
    return db.prepare(
      `SELECT CAST(t.id AS TEXT) AS id, t.name AS label,
              CAST(COUNT(mt.media_id) AS TEXT) || ' 个视频' AS meta
       FROM video_tags t LEFT JOIN media_asset_tags mt ON mt.tag_id = t.id
       WHERE ? = '%%' OR t.name LIKE ?
       GROUP BY t.id ORDER BY t.sort_order, t.name COLLATE NOCASE LIMIT ?`,
    ).all(pattern, pattern, size) as EntitlementTargetOption[];
  }
  if (targetType === "audio_folder" || targetType === "file_folder") {
    const kind = targetType === "audio_folder" ? "audio" : "file";
    return db.prepare(
      `SELECT CASE WHEN media_folder = '' THEN '/' ELSE media_folder END AS id,
              CASE WHEN media_folder = '' THEN '根目录' ELSE media_folder END AS label,
              CAST(COUNT(*) AS TEXT) || ' 项' AS meta
       FROM (
         SELECT ${MEDIA_FOLDER_SQL} AS media_folder
         FROM media_assets WHERE kind = ?
       )
       WHERE ? = '%%' OR media_folder LIKE ?
       GROUP BY media_folder
       ORDER BY natural_sort_key(media_folder), media_folder LIMIT ?`,
    ).all(kind, pattern, pattern, size) as EntitlementTargetOption[];
  }
  const kind = targetType === "video" ? "video" : targetType === "audio" ? "audio" : "file";
  return db.prepare(
    `SELECT CAST(id AS TEXT) AS id, title AS label,
            CASE WHEN ${MEDIA_FOLDER_SQL} = ''
              THEN file_name ELSE ${MEDIA_FOLDER_SQL} || ' / ' || file_name END AS meta
     FROM media_assets
     WHERE kind = ? AND (? = '%%' OR title LIKE ? OR file_name LIKE ?)
     ORDER BY natural_sort_key(title), id LIMIT ?`,
  ).all(kind, pattern, pattern, pattern, size) as EntitlementTargetOption[];
}

export function getEntitlementTargetOption(
  targetType: EntitlementTargetType,
  targetId: string,
): EntitlementTargetOption | null {
  const id = targetId.trim();
  if (!id) return null;
  const db = getDb();
  const numericId = Number(id);
  if (targetType === "novel") {
    return (db.prepare(
      `SELECT CAST(n.id AS TEXT) AS id, n.title AS label, COALESCE(s.name, '默认来源') AS meta
       FROM novels n LEFT JOIN novel_sources s ON s.id = n.source_id WHERE n.id = ?`,
    ).get(numericId) as EntitlementTargetOption | undefined) || null;
  }
  if (targetType === "novel_source") {
    return (db.prepare(
      `SELECT CAST(s.id AS TEXT) AS id, s.name AS label, CAST(COUNT(n.id) AS TEXT) || ' 本小说' AS meta
       FROM novel_sources s LEFT JOIN novels n ON n.source_id = s.id WHERE s.id = ? GROUP BY s.id`,
    ).get(numericId) as EntitlementTargetOption | undefined) || null;
  }
  if (targetType === "video_category") {
    return (db.prepare(
      `SELECT CAST(c.id AS TEXT) AS id, c.name AS label, CAST(COUNT(m.id) AS TEXT) || ' 个视频' AS meta
       FROM video_categories c LEFT JOIN media_assets m ON m.category_id = c.id AND m.kind = 'video'
       WHERE c.id = ? GROUP BY c.id`,
    ).get(numericId) as EntitlementTargetOption | undefined) || null;
  }
  if (targetType === "video_tag") {
    return (db.prepare(
      `SELECT CAST(t.id AS TEXT) AS id, t.name AS label, CAST(COUNT(mt.media_id) AS TEXT) || ' 个视频' AS meta
       FROM video_tags t LEFT JOIN media_asset_tags mt ON mt.tag_id = t.id WHERE t.id = ? GROUP BY t.id`,
    ).get(numericId) as EntitlementTargetOption | undefined) || null;
  }
  if (targetType === "audio_folder" || targetType === "file_folder") {
    const kind = targetType === "audio_folder" ? "audio" : "file";
    const folder = id === "/" ? "" : id;
    return (db.prepare(
      `SELECT CASE WHEN media_folder = '' THEN '/' ELSE media_folder END AS id,
              CASE WHEN media_folder = '' THEN '根目录' ELSE media_folder END AS label,
              CAST(COUNT(*) AS TEXT) || ' 项' AS meta
       FROM (
         SELECT ${MEDIA_FOLDER_SQL} AS media_folder
         FROM media_assets WHERE kind = ?
       )
       WHERE media_folder = ? GROUP BY media_folder`,
    ).get(kind, folder) as EntitlementTargetOption | undefined) || null;
  }
  const kind = targetType === "video" ? "video" : targetType === "audio" ? "audio" : "file";
  return (db.prepare(
    `SELECT CAST(id AS TEXT) AS id, title AS label,
            CASE WHEN ${MEDIA_FOLDER_SQL} = ''
              THEN file_name ELSE ${MEDIA_FOLDER_SQL} || ' / ' || file_name END AS meta
     FROM media_assets WHERE kind = ? AND id = ?`,
  ).get(kind, numericId) as EntitlementTargetOption | undefined) || null;
}
