import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import {
  mediaFolderFromStoredName,
  normalizeMediaFolder,
  normalizeMediaSortBy,
  normalizeMediaSortOrder,
  type MediaAsset,
  type MediaFolder,
  type MediaKind,
  type MediaSortBy,
  type MediaSortOrder,
  type VideoCategory,
  type VideoTag,
} from "./media-model";

type MediaRow = QueryResultRow & {
  id: string | number; kind: string; storage_node_id: string | null; category_id: string | number | null;
  title: string; artist: string; description: string; file_name: string; stored_name: string; mime_type: string;
  size_bytes: string | number; mtime_ms: string | number; duration_seconds: string | number | null;
  thumbnail_version: string | number; custom_cover_key: string | null; playback_format: string; playback_version: string;
  playback_manifest_path: string | null; playback_status: string; playback_error: string;
  playback_published_at: Date | string | null; play_count: string | number; recommend_count: string | number;
  download_count: string | number; published_at: Date | string; content_updated_at: Date | string;
  new_until: Date | string | null; play_soda_price: string | number; download_soda_price: string | number;
  created_at: Date | string; updated_at: Date | string;
};
type VideoCategoryRow = QueryResultRow & {
  id: string | number; name: string; sort_order: number; is_visible: boolean; video_count: string | number;
  created_at: Date | string; updated_at: Date | string;
};
type VideoTagRow = QueryResultRow & {
  id: string | number; name: string; slug: string; description: string; sort_order: number; is_visible: boolean;
  video_count: string | number; created_at: Date | string; updated_at: Date | string;
};
type MediaVideoTagRow = VideoTagRow & { media_id: string | number };
type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

function integer(value: string | number, label: string, minimum = 0): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function numberValue(value: string | number | null, label: string): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function timestamp(value: Date | string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed.toISOString();
}

function kind(value: string): MediaKind {
  if (value !== "video" && value !== "audio" && value !== "file") throw new Error("Invalid PostgreSQL media kind");
  return value;
}

function playbackStatus(value: string): MediaAsset["playbackStatus"] {
  if (value === "pending" || value === "processing" || value === "ready" || value === "failed") return value;
  return "none";
}

export function postgresMediaRowToAsset(row: MediaRow): MediaAsset {
  const mediaKind = kind(row.kind);
  return {
    id: integer(row.id, "media id", 1), kind: mediaKind, storageNodeId: row.storage_node_id,
    categoryId: row.category_id === null ? null : integer(row.category_id, "media category id", 1),
    title: row.title, artist: row.artist, description: row.description, fileName: row.file_name,
    storedName: row.stored_name, folder: mediaFolderFromStoredName(row.stored_name, mediaKind), mimeType: row.mime_type,
    sizeBytes: integer(row.size_bytes, "media size"), mtimeMs: integer(row.mtime_ms, "media mtime"),
    durationSeconds: numberValue(row.duration_seconds, "media duration"),
    thumbnailVersion: integer(row.thumbnail_version, "media thumbnail version"), customCoverKey: row.custom_cover_key,
    playbackFormat: row.playback_format === "hls" ? "hls" : "mp4", playbackVersion: row.playback_version,
    playbackManifestPath: row.playback_manifest_path, playbackStatus: playbackStatus(row.playback_status),
    playbackError: row.playback_error, playbackPublishedAt: timestamp(row.playback_published_at, "media playback publication"),
    playCount: integer(row.play_count, "media play count"), recommendCount: integer(row.recommend_count, "media recommendation count"),
    downloadCount: integer(row.download_count, "media download count"), publishedAt: timestamp(row.published_at, "media publication")!,
    contentUpdatedAt: timestamp(row.content_updated_at, "media content update")!, newUntil: timestamp(row.new_until, "media new-until"),
    playSodaPrice: integer(row.play_soda_price, "media play price"), downloadSodaPrice: integer(row.download_soda_price, "media download price"),
    createdAt: timestamp(row.created_at, "media creation")!, updatedAt: timestamp(row.updated_at, "media update")!,
  };
}

function category(row: VideoCategoryRow): VideoCategory {
  return {
    id: integer(row.id, "video category id", 1), name: row.name, sortOrder: row.sort_order,
    visible: row.is_visible === true, videoCount: integer(row.video_count, "video category count"),
    createdAt: timestamp(row.created_at, "video category creation")!, updatedAt: timestamp(row.updated_at, "video category update")!,
  };
}

function tag(row: VideoTagRow): VideoTag {
  return {
    id: integer(row.id, "video tag id", 1), name: row.name, slug: row.slug, description: row.description,
    sortOrder: row.sort_order, visible: row.is_visible === true, videoCount: integer(row.video_count, "video tag count"),
    createdAt: timestamp(row.created_at, "video tag creation")!, updatedAt: timestamp(row.updated_at, "video tag update")!,
  };
}

export async function getPostgresMediaAsset(executor: SqlExecutor, idValue: number): Promise<MediaAsset | null> {
  if (!Number.isSafeInteger(idValue) || idValue < 1) return null;
  const result = await executor.query<MediaRow>({ name: "media-get-asset-v1", text: "SELECT * FROM media_assets WHERE id = $1", values: [idValue] });
  return result.rows[0] ? postgresMediaRowToAsset(result.rows[0]) : null;
}

export async function getPostgresMediaAssetByStoredName(
  executor: SqlExecutor, storedNameValue: string, storageNodeId?: string | null,
): Promise<MediaAsset | null> {
  const storedName = normalizeMediaFolder(storedNameValue);
  if (!storedName) return null;
  const result = storageNodeId === undefined
    ? await executor.query<MediaRow>({ text: "SELECT * FROM media_assets WHERE stored_name = $1", values: [storedName] })
    : await executor.query<MediaRow>({
        text: `SELECT * FROM media_assets WHERE stored_name = $1
          AND storage_node_id IS NOT DISTINCT FROM $2::text`,
        values: [storedName, storageNodeId],
      });
  return result.rows[0] ? postgresMediaRowToAsset(result.rows[0]) : null;
}

export async function listPostgresMediaAssetsByIds(executor: SqlExecutor, values: readonly number[]): Promise<MediaAsset[]> {
  const ids = [...new Set(values.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return [];
  const result = await executor.query<MediaRow>({ text: "SELECT * FROM media_assets WHERE id = ANY($1::bigint[])", values: [ids] });
  const byId = new Map(result.rows.map((row) => [integer(row.id, "media id", 1), postgresMediaRowToAsset(row)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

function escapedLike(value: string): string {
  return `%${value.replace(/[\\%_]/gu, "\\$&")}%`;
}

function mediaOrder(sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const direction = sortOrder === "asc" ? "ASC" : "DESC";
  if (sortBy === "size") return `size_bytes ${direction}, lower(title), id`;
  if (sortBy === "duration") return `duration_seconds ${direction} NULLS LAST, lower(title), id`;
  if (sortBy === "plays") return `play_count ${direction}, lower(title), id`;
  if (sortBy === "published") return `published_at ${direction}, id ${direction}`;
  if (sortBy === "updated") return `updated_at ${direction}, id ${direction}`;
  return `lower(title) ${direction}, lower(file_name) ${direction}, id ${direction}`;
}

export async function listPostgresMediaAssets(executor: SqlExecutor, params: {
  kind?: MediaKind; videoCategoryId?: number | null; videoTagId?: number; folder?: string; recursive?: boolean;
  query?: string; page?: number; pageSize?: number; sortBy?: MediaSortBy; sortOrder?: MediaSortOrder;
} = {}): Promise<{ assets: MediaAsset[]; page: number; totalPages: number; totalAssets: number; query: string; folder: string }> {
  const query = Array.from((params.query || "").normalize("NFKC").replace(/\s+/gu, " ").trim()).slice(0, 100).join("");
  const terms = query.split(" ").filter(Boolean).slice(0, 8);
  const pageSize = Number.isFinite(params.pageSize) ? Math.min(Math.max(Math.floor(params.pageSize ?? 18), 1), 100) : 18;
  const requestedPage = Number.isFinite(params.page) ? Math.max(Math.floor(params.page ?? 1), 1) : 1;
  const sortBy = normalizeMediaSortBy(params.sortBy);
  const sortOrder = normalizeMediaSortOrder(params.sortOrder, sortBy);
  const folder = params.kind ? normalizeMediaFolder(params.folder || "") || "" : "";
  const filters: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  if (params.kind) {
    filters.push(`asset.kind = ${bind(params.kind)}`);
    const prefix = `${params.kind}/${folder ? `${folder}/` : ""}`;
    const prefixBind = bind(`${prefix.replace(/[\\%_]/gu, "\\$&")}%`);
    filters.push(`asset.stored_name LIKE ${prefixBind} ESCAPE '\\'`);
    if (!params.recursive && !query) {
      filters.push(`strpos(substring(asset.stored_name FROM ${prefix.length + 1}), '/') = 0`);
    }
  }
  if (params.kind === "video" && params.videoCategoryId !== undefined) {
    filters.push(params.videoCategoryId === null ? "asset.category_id IS NULL" : `asset.category_id = ${bind(params.videoCategoryId)}`);
  }
  if (params.kind === "video" && params.videoTagId !== undefined) {
    filters.push(`EXISTS (SELECT 1 FROM media_asset_tags relation WHERE relation.media_id = asset.id AND relation.tag_id = ${bind(params.videoTagId)})`);
  }
  for (const term of terms) {
    const termBind = bind(escapedLike(term));
    const columns = params.kind === "video"
      ? ["title", "file_name", "description", "stored_name"]
      : ["title", "file_name", "artist", "description", "stored_name"];
    filters.push(`(${columns.map((column) => `asset.${column} ILIKE ${termBind} ESCAPE '\\'`).join(" OR ")})`);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const pageBind = bind(requestedPage);
  const sizeBind = bind(pageSize);
  const result = await executor.query<MediaRow & { total_assets: string | number; total_pages: string | number; page: string | number }>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_assets,
          GREATEST(CEIL(COUNT(*)::numeric / ${sizeBind}::integer), 1)::bigint AS total_pages
        FROM media_assets asset ${where}
      ), requested AS (
        SELECT total_assets, total_pages, LEAST(${pageBind}::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.total_assets, requested.total_pages, requested.page, asset.*
      FROM requested LEFT JOIN LATERAL (
        SELECT asset.* FROM media_assets asset ${where}
        ORDER BY ${mediaOrder(sortBy, sortOrder)}
        LIMIT ${sizeBind} OFFSET ((requested.page - 1) * ${sizeBind})
      ) asset ON TRUE`,
    values,
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL media page metadata is missing");
  const totalAssets = integer(first.total_assets, "media total");
  return {
    assets: totalAssets ? result.rows.map(postgresMediaRowToAsset) : [],
    page: integer(first.page, "media page", 1), totalPages: integer(first.total_pages, "media pages", 1), totalAssets, query, folder,
  };
}

export async function listPostgresMediaFolderAssets(
  executor: SqlExecutor, mediaKind: MediaKind, folderValue: string, limit = 1_000,
): Promise<MediaAsset[]> {
  const folder = normalizeMediaFolder(folderValue) || "";
  const prefix = `${mediaKind}/${folder ? `${folder}/` : ""}`;
  const size = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 2_000) : 1_000;
  const result = await executor.query<MediaRow>({
    text: `SELECT * FROM media_assets
      WHERE kind = $1 AND stored_name LIKE $2 ESCAPE '\\'
        AND strpos(substring(stored_name FROM $3::integer), '/') = 0
      ORDER BY lower(title), id LIMIT $4`,
    values: [mediaKind, `${prefix.replace(/[\\%_]/gu, "\\$&")}%`, prefix.length + 1, size],
  });
  return result.rows.map(postgresMediaRowToAsset);
}

export async function listPostgresRelatedVideoAssets(
  executor: SqlExecutor, currentIdValue: number, countValue: number, mode: "next" | "random",
): Promise<MediaAsset[]> {
  const currentId = integer(currentIdValue, "media id", 1);
  const limit = Number.isFinite(countValue) ? Math.min(Math.max(Math.floor(countValue), 0), 20) : 0;
  if (!limit) return [];
  const result = await executor.query<MediaRow>({
    text: mode === "random"
      ? `WITH bounds AS (SELECT COALESCE(MAX(id), 0)::bigint AS maximum FROM media_assets WHERE kind = 'video'),
          pivot AS (SELECT CASE WHEN maximum = 0 THEN 0 ELSE 1 + floor(random() * maximum)::bigint END AS id FROM bounds)
        SELECT asset.* FROM media_assets asset CROSS JOIN pivot
        WHERE asset.kind = 'video' AND asset.id <> $1
        ORDER BY CASE WHEN asset.id >= pivot.id THEN 0 ELSE 1 END, asset.id LIMIT $2`
      : `SELECT * FROM media_assets WHERE kind = 'video' AND id <> $1
        ORDER BY CASE WHEN id > $1 THEN 0 ELSE 1 END, id LIMIT $2`,
    values: [currentId, limit],
  });
  return result.rows.map(postgresMediaRowToAsset);
}

export async function listPostgresVideoCategories(executor: SqlExecutor, options: { includeHidden?: boolean } = {}): Promise<VideoCategory[]> {
  const result = await executor.query<VideoCategoryRow>({
    text: `SELECT category.id, category.name, category.sort_order, category.is_visible,
      category.created_at, category.updated_at, COUNT(asset.id)::bigint AS video_count
      FROM video_categories category
      LEFT JOIN media_assets asset ON asset.category_id = category.id AND asset.kind = 'video'
      ${options.includeHidden ? "" : "WHERE category.is_visible = true"}
      GROUP BY category.id ORDER BY category.sort_order, lower(category.name), category.id`,
  });
  return result.rows.map(category);
}

export async function listPostgresVideoTags(executor: SqlExecutor, options: {
  includeHidden?: boolean; query?: string; page?: number; pageSize?: number;
} = {}): Promise<{ tags: VideoTag[]; page: number; totalPages: number; totalTags: number; query: string }> {
  const query = Array.from(String(options.query || "").normalize("NFKC").replace(/\s+/gu, " ").trim()).slice(0, 80).join("");
  const terms = query.split(" ").filter(Boolean).slice(0, 4);
  const pageSize = Number.isFinite(options.pageSize) ? Math.min(Math.max(Math.floor(options.pageSize ?? 48), 1), 5_000) : 48;
  const requestedPage = Number.isFinite(options.page) ? Math.max(Math.floor(options.page ?? 1), 1) : 1;
  const filters = options.includeHidden ? [] : ["tag.is_visible = true"];
  const values: unknown[] = [];
  for (const term of terms) {
    values.push(escapedLike(term));
    filters.push(`(tag.name ILIKE $${values.length} ESCAPE '\\' OR tag.description ILIKE $${values.length} ESCAPE '\\')`);
  }
  values.push(requestedPage, pageSize);
  const pageBind = `$${values.length - 1}`;
  const sizeBind = `$${values.length}`;
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const result = await executor.query<VideoTagRow & { total_tags: string | number; total_pages: string | number; page: string | number }>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_tags, GREATEST(CEIL(COUNT(*)::numeric / ${sizeBind}::integer), 1)::bigint AS total_pages
        FROM video_tags tag ${where}
      ), requested AS (
        SELECT total_tags, total_pages, LEAST(${pageBind}::bigint, total_pages) AS page FROM page_info
      )
      SELECT requested.total_tags, requested.total_pages, requested.page, tag.*
      FROM requested LEFT JOIN LATERAL (
        SELECT tag.id, tag.name, tag.slug, tag.description, tag.sort_order, tag.is_visible,
          tag.created_at, tag.updated_at, COUNT(asset.id)::bigint AS video_count
        FROM video_tags tag
        LEFT JOIN media_asset_tags relation ON relation.tag_id = tag.id
        LEFT JOIN media_assets asset ON asset.id = relation.media_id AND asset.kind = 'video'
        ${where} GROUP BY tag.id
        ORDER BY tag.sort_order, lower(tag.name), tag.id
        LIMIT ${sizeBind} OFFSET ((requested.page - 1) * ${sizeBind})
      ) tag ON TRUE`,
    values,
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL video-tag page metadata is missing");
  const totalTags = integer(first.total_tags, "video tag total");
  return {
    tags: totalTags ? result.rows.map(tag) : [], page: integer(first.page, "video tag page", 1),
    totalPages: integer(first.total_pages, "video tag pages", 1), totalTags, query,
  };
}

export async function getPostgresVideoTagBySlug(
  executor: SqlExecutor, slugValue: unknown, options: { includeHidden?: boolean } = {},
): Promise<VideoTag | null> {
  const slug = Array.from(String(slugValue || "").normalize("NFKC").trim()).slice(0, 80).join("");
  if (!slug) return null;
  const result = await executor.query<VideoTagRow>({
    text: `SELECT tag.id, tag.name, tag.slug, tag.description, tag.sort_order, tag.is_visible,
      tag.created_at, tag.updated_at, COUNT(asset.id)::bigint AS video_count
      FROM video_tags tag
      LEFT JOIN media_asset_tags relation ON relation.tag_id = tag.id
      LEFT JOIN media_assets asset ON asset.id = relation.media_id AND asset.kind = 'video'
      WHERE lower(tag.slug) = lower($1) ${options.includeHidden ? "" : "AND tag.is_visible = true"}
      GROUP BY tag.id`,
    values: [slug],
  });
  return result.rows[0] ? tag(result.rows[0]) : null;
}

export async function listPostgresVideoTagsForAssets(executor: SqlExecutor, values: readonly number[]): Promise<Record<number, VideoTag[]>> {
  const ids = [...new Set(values.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!ids.length) return {};
  const result = await executor.query<MediaVideoTagRow>({
    text: `SELECT relation.media_id, tag.id, tag.name, tag.slug, tag.description, tag.sort_order, tag.is_visible,
      tag.created_at, tag.updated_at, 0::bigint AS video_count
      FROM media_asset_tags relation JOIN video_tags tag ON tag.id = relation.tag_id
      WHERE relation.media_id = ANY($1::bigint[])
      ORDER BY tag.sort_order, lower(tag.name), tag.id`,
    values: [ids],
  });
  const mapped: Record<number, VideoTag[]> = {};
  for (const row of result.rows) (mapped[integer(row.media_id, "media id", 1)] ||= []).push(tag(row));
  return mapped;
}

export async function listPostgresVideoTagsForAsset(executor: SqlExecutor, assetId: number): Promise<VideoTag[]> {
  return (await listPostgresVideoTagsForAssets(executor, [assetId]))[assetId] ?? [];
}

export async function listPostgresMediaFolders(executor: SqlExecutor, mediaKind: MediaKind): Promise<MediaFolder[]> {
  const result = await executor.query<QueryResultRow & {
    path: string; direct_assets: string | number; total_assets: string | number; total_size_bytes: string | number; mtime_ms: string | number;
  }>({
    text: `WITH RECURSIVE asset_folders AS (
        SELECT regexp_replace(substr(stored_name, length(kind) + 2), '(^|/)[^/]+$', '') AS folder,
          size_bytes, mtime_ms FROM media_assets WHERE kind = $1
      ), expanded(path, source_folder, size_bytes, mtime_ms) AS (
        SELECT folder, folder, size_bytes, mtime_ms FROM asset_folders WHERE folder <> ''
        UNION ALL
        SELECT regexp_replace(path, '/[^/]+$', ''), source_folder, size_bytes, mtime_ms
        FROM expanded WHERE position('/' in path) > 0
      ), registered AS (
        SELECT path, MAX(mtime_ms)::bigint AS mtime_ms
        FROM media_folders WHERE kind = $1 GROUP BY path
      ), paths AS (
        SELECT path FROM registered
        UNION
        SELECT path FROM expanded
      )
      SELECT paths.path,
        COUNT(expanded.source_folder) FILTER (WHERE paths.path = expanded.source_folder)::bigint AS direct_assets,
        COUNT(expanded.source_folder)::bigint AS total_assets,
        COALESCE(SUM(expanded.size_bytes), 0)::bigint AS total_size_bytes,
        GREATEST(COALESCE(MAX(registered.mtime_ms), 0), COALESCE(MAX(expanded.mtime_ms), 0))::bigint AS mtime_ms
      FROM paths
      LEFT JOIN registered ON registered.path = paths.path
      LEFT JOIN expanded ON expanded.path = paths.path
      GROUP BY paths.path ORDER BY lower(paths.path)`,
    values: [mediaKind],
  });
  return result.rows.map((row) => ({
    path: row.path, name: row.path.split("/").at(-1) || row.path, depth: row.path.split("/").length - 1,
    directAssets: integer(row.direct_assets, "folder direct assets"), totalAssets: integer(row.total_assets, "folder total assets"),
    totalSizeBytes: integer(row.total_size_bytes, "folder size"), mtimeMs: integer(row.mtime_ms, "folder mtime"),
  }));
}

export async function incrementPostgresMediaPlayCount(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "UPDATE media_assets SET play_count = play_count + 1 WHERE id = $1 AND kind IN ('video', 'audio')",
    values: [integer(idValue, "media id", 1)],
  });
  return result.rowCount === 1;
}

export async function incrementPostgresMediaDownloadCount(executor: SqlExecutor, idValue: number): Promise<boolean> {
  const result = await executor.query({
    text: "UPDATE media_assets SET download_count = download_count + 1 WHERE id = $1",
    values: [integer(idValue, "media id", 1)],
  });
  return result.rowCount === 1;
}

export async function replacePostgresMediaCustomCoverKey(
  idValue: number,
  nextKeyValue: string | null,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<string | null | undefined> {
  const id = integer(idValue, "media id", 1);
  const nextKey = nextKeyValue === null ? null : /^[a-f0-9]{32}$/u.test(nextKeyValue) ? nextKeyValue : undefined;
  if (nextKey === undefined) throw new TypeError("Invalid media cover key");
  return transaction(async (tx) => {
    const current = await tx.query<QueryResultRow & { custom_cover_key: string | null }>({
      text: "SELECT custom_cover_key FROM media_assets WHERE id = $1 AND kind = 'video' FOR UPDATE",
      values: [id],
    });
    if (!current.rows[0]) return undefined;
    await tx.query({
      text: `UPDATE media_assets SET custom_cover_key = $2,
        thumbnail_version = thumbnail_version + 1, updated_at = clock_timestamp() WHERE id = $1`,
      values: [id, nextKey],
    });
    return current.rows[0].custom_cover_key;
  });
}
