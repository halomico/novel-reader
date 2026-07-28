import type { Novel } from "./books";
import { getDb } from "./db";
import {
  mediaFolderFromStoredName,
  type FeedbackMediaKind,
  type MediaAsset,
  type MediaKind,
} from "./media";

export type FavoriteNovelPage = {
  books: Novel[];
  page: number;
  pageSize: number;
  totalBooks: number;
  totalPages: number;
};

export type FavoriteMediaPage = {
  assets: MediaAsset[];
  page: number;
  pageSize: number;
  totalAssets: number;
  totalPages: number;
};

export function isNovelFavorite(userId: number, novelId: number): boolean {
  return Boolean(getDb()
    .prepare("SELECT 1 AS found FROM user_novel_favorites WHERE user_id = ? AND novel_id = ?")
    .get(userId, novelId));
}

export function toggleNovelFavorite(userId: number, novelId: number): { ok: boolean; favorite: boolean } {
  const db = getDb();
  const removed = db
    .prepare("DELETE FROM user_novel_favorites WHERE user_id = ? AND novel_id = ?")
    .run(userId, novelId);
  if (removed.changes > 0) {
    return { ok: true, favorite: false };
  }
  const added = db
    .prepare(
      `INSERT INTO user_novel_favorites (user_id, novel_id)
       SELECT ?, id FROM novels WHERE id = ?`,
    )
    .run(userId, novelId);
  return { ok: added.changes > 0, favorite: added.changes > 0 };
}

function normalizeFavoriteIds(values: readonly number[]): number[] {
  return Array.from(new Set(values))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 500);
}

export function removeNovelFavorites(userId: number, novelIds: readonly number[]): number {
  const ids = normalizeFavoriteIds(novelIds);
  if (!ids.length) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(",");
  return Number(getDb()
    .prepare(
      `DELETE FROM user_novel_favorites
       WHERE user_id = ? AND novel_id IN (${placeholders})`,
    )
    .run(userId, ...ids).changes);
}

export function listFavoriteNovels(userId: number, pageValue = 1, pageSizeValue = 20): FavoriteNovelPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(pageSizeValue), 1), 100);
  const total = db
    .prepare("SELECT COUNT(*) AS count FROM user_novel_favorites WHERE user_id = ?")
    .get(userId) as { count: number };
  const totalPages = Math.max(Math.ceil(total.count / pageSize), 1);
  const requestedPage = Number.isFinite(pageValue) ? Math.floor(pageValue) : 1;
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const books = db
    .prepare(
      `SELECT n.id, n.title, n.file_name, n.relative_path, n.content_hash,
              n.size_bytes, n.mtime_ms, n.word_count, n.visit_count,
              n.last_accessed_at, n.last_accessed_ip, n.last_accessed_user_agent,
              n.created_at, n.updated_at
       FROM user_novel_favorites f
       INNER JOIN novels n ON n.id = f.novel_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC, f.novel_id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, pageSize, (page - 1) * pageSize) as Novel[];
  return { books, page, pageSize, totalBooks: total.count, totalPages };
}

export function isMediaFavorite(userId: number, mediaId: number): boolean {
  return Boolean(getDb()
    .prepare("SELECT 1 AS found FROM user_media_favorites WHERE user_id = ? AND media_id = ?")
    .get(userId, mediaId));
}

export function toggleMediaFavorite(userId: number, mediaId: number): { ok: boolean; favorite: boolean } {
  const db = getDb();
  const removed = db
    .prepare("DELETE FROM user_media_favorites WHERE user_id = ? AND media_id = ?")
    .run(userId, mediaId);
  if (removed.changes > 0) {
    return { ok: true, favorite: false };
  }
  const added = db
    .prepare(
      `INSERT INTO user_media_favorites (user_id, media_id)
       SELECT ?, id FROM media_assets WHERE id = ? AND kind IN ('video', 'audio')`,
    )
    .run(userId, mediaId);
  return { ok: added.changes > 0, favorite: added.changes > 0 };
}

export function removeMediaFavorites(
  userId: number,
  kind: FeedbackMediaKind,
  mediaIds: readonly number[],
): number {
  const ids = normalizeFavoriteIds(mediaIds);
  if (!ids.length) {
    return 0;
  }
  const placeholders = ids.map(() => "?").join(",");
  return Number(getDb()
    .prepare(
      `DELETE FROM user_media_favorites
       WHERE user_id = ?
         AND media_id IN (
           SELECT id
           FROM media_assets
           WHERE kind = ? AND id IN (${placeholders})
         )`,
    )
    .run(userId, kind, ...ids).changes);
}

export function listFavoriteMedia(
  userId: number,
  kind: FeedbackMediaKind,
  pageValue = 1,
  pageSizeValue = kind === "audio" ? 50 : 30,
): FavoriteMediaPage {
  const db = getDb();
  const pageSize = Math.min(Math.max(Math.floor(pageSizeValue), 1), 100);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM user_media_favorites f
       INNER JOIN media_assets m ON m.id = f.media_id
       WHERE f.user_id = ? AND m.kind = ?`,
    )
    .get(userId, kind) as { count: number };
  const totalPages = Math.max(Math.ceil(total.count / pageSize), 1);
  const requestedPage = Number.isFinite(pageValue) ? Math.floor(pageValue) : 1;
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  const rows = db
    .prepare(
      `SELECT m.*
       FROM user_media_favorites f
       INNER JOIN media_assets m ON m.id = f.media_id
       WHERE f.user_id = ? AND m.kind = ?
       ORDER BY f.created_at DESC, f.media_id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(userId, kind, pageSize, (page - 1) * pageSize) as Array<{
    id: number;
    kind: MediaKind;
    storage_node_id: string | null;
    category_id: number | null;
    title: string;
    artist: string;
    description: string;
    file_name: string;
    stored_name: string;
    mime_type: string;
    size_bytes: number;
    mtime_ms: number;
    duration_seconds: number | null;
    thumbnail_version: number;
    custom_cover_key: string | null;
    play_count: number;
    recommend_count: number;
    download_count: number;
    created_at: string;
    updated_at: string;
  }>;
  const assets = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    storageNodeId: row.storage_node_id,
    categoryId: row.category_id,
    title: row.title,
    artist: row.artist,
    description: row.description,
    fileName: row.file_name,
    storedName: row.stored_name,
    folder: mediaFolderFromStoredName(row.stored_name, row.kind),
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    mtimeMs: row.mtime_ms,
    durationSeconds: row.duration_seconds,
    thumbnailVersion: row.thumbnail_version,
    customCoverKey: row.custom_cover_key,
    playCount: row.play_count,
    recommendCount: row.recommend_count,
    downloadCount: row.download_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  return { assets, page, pageSize, totalAssets: total.count, totalPages };
}
