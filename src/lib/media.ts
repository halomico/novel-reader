import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  canBrowseHomePortalContent,
  canConsumeHomePortalContent,
  canSeeHomePortalContentEntry,
  getMediaDir,
  isAudioLibraryEnabled,
  isFileLibraryEnabled,
  isVideoLibraryEnabled,
} from "./config";
import { getDb } from "./db";
import {
  createRemoteMediaFolder,
  deleteRemoteMediaAssets,
  deleteRemoteMediaFolder,
  MediaNodeClientError,
  moveRemoteMediaAsset,
  readRemoteMediaManifest,
  renameRemoteMediaFolder,
} from "./media-node-client";
import { deleteMediaCustomCover } from "./media-cover";
import {
  getRemoteMediaNodeForKind,
  isRemoteMediaStorage,
  listRemoteMediaNodes,
  remoteMediaRegistryFingerprint,
  resolveRemoteMediaNodeForAsset,
} from "./media-storage-config";
import { isIgnoredMediaStorageEntry } from "./media-scan-filter";
import { normalizeMediaStoragePath, resolveMediaStoragePath } from "./media-storage-path";
import { removePlaybackHlsVersions, resolvePlaybackHlsFile } from "./video-hls";

export type MediaKind = "video" | "audio" | "file";
export type FeedbackMediaKind = Extract<MediaKind, "video" | "audio">;
export type MediaSortBy = "name" | "published" | "duration" | "size" | "updated" | "plays";
export type MediaSortOrder = "asc" | "desc";

export type MediaAsset = {
  id: number;
  kind: MediaKind;
  storageNodeId: string | null;
  categoryId: number | null;
  title: string;
  artist: string;
  description: string;
  fileName: string;
  storedName: string;
  folder: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
  durationSeconds: number | null;
  thumbnailVersion: number;
  customCoverKey: string | null;
  playbackFormat: "mp4" | "hls";
  playbackVersion: string;
  playbackManifestPath: string | null;
  playbackStatus: "none" | "pending" | "processing" | "ready" | "failed";
  playbackError: string;
  playbackPublishedAt: string | null;
  playCount: number;
  recommendCount: number;
  downloadCount: number;
  publishedAt: string;
  contentUpdatedAt: string;
  newUntil: string | null;
  playSodaPrice: number;
  downloadSodaPrice: number;
  createdAt: string;
  updatedAt: string;
};

export type VideoCategory = {
  id: number;
  name: string;
  sortOrder: number;
  visible: boolean;
  videoCount: number;
  createdAt: string;
  updatedAt: string;
};

export type VideoTag = {
  id: number;
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  visible: boolean;
  videoCount: number;
  createdAt: string;
  updatedAt: string;
};

export type MediaFolder = {
  path: string;
  name: string;
  depth: number;
  directAssets: number;
  totalAssets: number;
  totalSizeBytes: number;
  mtimeMs: number;
};

export type MediaSyncResult = {
  added: number;
  updated: number;
  removed: number;
};

type MediaRow = {
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
  playback_format: "mp4" | "hls";
  playback_version: string;
  playback_manifest_path: string | null;
  playback_status: "none" | "pending" | "processing" | "ready" | "failed";
  playback_error: string;
  playback_published_at: string | null;
  play_count: number;
  recommend_count: number;
  download_count: number;
  published_at: string | null;
  content_updated_at: string | null;
  new_until: string | null;
  play_soda_price: number;
  download_soda_price: number;
  created_at: string;
  updated_at: string;
};

type VideoCategoryRow = {
  id: number;
  name: string;
  sort_order: number;
  is_visible: number;
  video_count: number;
  created_at: string;
  updated_at: string;
};

type VideoTagRow = {
  id: number;
  name: string;
  slug: string;
  description: string;
  sort_order: number;
  is_visible: number;
  video_count: number;
  created_at: string;
  updated_at: string;
};

type MediaVideoTagRow = VideoTagRow & { media_id: number };

type ScannedMediaFile = {
  kind: MediaKind;
  storageNodeId: string | null;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs: number;
};

type ScannedMediaLibrary = {
  files: Map<string, ScannedMediaFile>;
  folders: Record<MediaKind, Array<{ path: string; mtimeMs: number }>>;
};

type MediaLibrarySyncState = {
  directory: string;
  syncedAt: number;
  prepared: boolean;
  running?: Promise<MediaSyncResult>;
  folders: Record<MediaKind, Array<{ path: string; mtimeMs: number }>>;
};

type MediaGlobal = typeof globalThis & {
  mediaLibrarySyncState?: MediaLibrarySyncState;
};

export class MediaFolderError extends Error {}
export class MediaCategoryError extends Error {}
export class MediaTagError extends Error {}

function remoteMediaError(error: unknown): never {
  if (error instanceof MediaNodeClientError) {
    throw new MediaFolderError(error.message);
  }
  throw error;
}

export const MEDIA_SYNC_INTERVAL_MS = 30 * 60 * 1_000;
const MEDIA_KINDS: MediaKind[] = ["video", "audio", "file"];

const MEDIA_MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".ts": "video/mp2t",
  ".mts": "video/mp2t",
  ".m2ts": "video/mp2t",
  ".ogv": "video/ogg",
  ".webm": "video/webm",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".epub": "application/epub+zip",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".zip": "application/zip",
};

const KIND_EXTENSIONS: Record<Exclude<MediaKind, "file">, Set<string>> = {
  video: new Set([".mp4", ".m4v", ".mov", ".ogv", ".webm"]),
  audio: new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".webm"]),
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function mediaStorageKey(storageNodeId: string | null, storedName: string): string {
  return `${storageNodeId || "local"}\u0000${storedName}`;
}

export function normalizeMediaFolder(value: unknown): string | null {
  return normalizeMediaStoragePath(value);
}

function normalizeFolderName(value: string): string | null {
  const name = value.trim();
  if (!name || name.length > 100 || name === "." || name === ".." || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name)) {
    return null;
  }
  return name;
}

export function mediaStoredName(kind: MediaKind, folder: string, fileName: string): string {
  const normalizedFolder = normalizeMediaFolder(folder);
  const safeFileName = path.basename(fileName.trim()).replace(/[\u0000-\u001f\u007f]/g, "");
  if (normalizedFolder === null || !safeFileName || safeFileName === "." || safeFileName === "..") {
    throw new MediaFolderError("资源路径无效");
  }
  return [kind, normalizedFolder, safeFileName].filter(Boolean).join("/");
}

export function mediaFilePath(storedName: string): string {
  try {
    return resolveMediaStoragePath(getMediaDir(), storedName);
  } catch (error) {
    throw new MediaFolderError(error instanceof Error ? error.message : "资源路径无效");
  }
}

export function mediaFolderFromStoredName(storedName: string, kind: MediaKind): string {
  const prefix = `${kind}/`;
  const normalized = toPosixPath(storedName);
  if (!normalized.startsWith(prefix)) {
    return "";
  }
  const relativeFile = normalized.slice(prefix.length);
  const slashIndex = relativeFile.lastIndexOf("/");
  return slashIndex < 0 ? "" : relativeFile.slice(0, slashIndex);
}

function toAsset(row: MediaRow): MediaAsset {
  return {
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
    playbackFormat: row.playback_format === "hls" ? "hls" : "mp4",
    playbackVersion: row.playback_version || "",
    playbackManifestPath: row.playback_manifest_path || null,
    playbackStatus: row.playback_status || "none",
    playbackError: row.playback_error || "",
    playbackPublishedAt: row.playback_published_at || null,
    playCount: row.play_count,
    recommendCount: row.recommend_count,
    downloadCount: row.download_count,
    publishedAt: row.published_at || row.created_at,
    contentUpdatedAt: row.content_updated_at || row.updated_at,
    newUntil: row.new_until,
    playSodaPrice: Math.max(Math.floor(row.play_soda_price || 0), 0),
    downloadSodaPrice: Math.max(Math.floor(row.download_soda_price ?? 1), 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVideoCategory(row: VideoCategoryRow): VideoCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    visible: row.is_visible === 1,
    videoCount: row.video_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVideoTag(row: VideoTagRow): VideoTag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    visible: row.is_visible === 1,
    videoCount: row.video_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeVideoCategoryName(value: string): string | null {
  const name = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  return name && name.length <= 24 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

function normalizeVideoCategorySortOrder(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), -9_999), 9_999) : 0;
}

function normalizeVideoTagName(value: unknown): string | null {
  const name = String(value || "").normalize("NFKC").trim().replace(/\s+/gu, " ");
  return name && name.length <= 40 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

function normalizeVideoTagDescription(value: unknown): string | null {
  const description = String(value || "").normalize("NFKC").trim();
  return description.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(description)
    ? description
    : null;
}

function videoTagSlugBase(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "tag";
}

function nextVideoTagSlug(name: string): string {
  const db = getDb();
  const base = videoTagSlugBase(name);
  let slug = base;
  let suffix = 2;
  while (db.prepare("SELECT id FROM video_tags WHERE slug = ? COLLATE NOCASE").get(slug)) {
    slug = `${base.slice(0, Math.max(1, 64 - String(suffix).length - 1))}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export function listVideoTags(options: { includeHidden?: boolean; query?: string; page?: number; pageSize?: number } = {}): {
  tags: VideoTag[];
  page: number;
  totalPages: number;
  totalTags: number;
  query: string;
} {
  const query = String(options.query || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const terms = query.split(" ").filter(Boolean).slice(0, 4);
  const pageSize = Math.min(Math.max(Math.floor(options.pageSize || 48), 1), 5_000);
  const filters = options.includeHidden ? [] : ["t.is_visible = 1"];
  const values: string[] = [];
  for (const term of terms) {
    filters.push("(t.name COLLATE NOCASE LIKE ? ESCAPE '\\' OR t.description COLLATE NOCASE LIKE ? ESCAPE '\\')");
    const escaped = `%${escapeLike(term)}%`;
    values.push(escaped, escaped);
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = getDb().prepare(`SELECT COUNT(*) AS count FROM video_tags t ${where}`).get(...values) as { count: number };
  const totalPages = Math.max(1, Math.ceil(count.count / pageSize));
  const page = Math.min(Math.max(Math.floor(options.page || 1), 1), totalPages);
  const rows = getDb()
    .prepare(
      `SELECT t.id, t.name, t.slug, t.description, t.sort_order, t.is_visible, t.created_at, t.updated_at,
              COUNT(a.id) AS video_count
       FROM video_tags t
       LEFT JOIN media_asset_tags mat ON mat.tag_id = t.id
       LEFT JOIN media_assets a ON a.id = mat.media_id AND a.kind = 'video'
       ${where}
       GROUP BY t.id
       ORDER BY t.sort_order ASC, natural_sort_key(t.name) ASC, t.name COLLATE NOCASE ASC, t.id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...values, pageSize, (page - 1) * pageSize) as VideoTagRow[];
  return {
    tags: rows.map(toVideoTag),
    page,
    totalPages,
    totalTags: count.count,
    query,
  };
}

export function getVideoTagBySlug(slugValue: unknown, options: { includeHidden?: boolean } = {}): VideoTag | null {
  const slug = String(slugValue || "").normalize("NFKC").trim().slice(0, 80);
  if (!slug) return null;
  const row = getDb()
    .prepare(
      `SELECT t.id, t.name, t.slug, t.description, t.sort_order, t.is_visible, t.created_at, t.updated_at,
              COUNT(a.id) AS video_count
       FROM video_tags t
       LEFT JOIN media_asset_tags mat ON mat.tag_id = t.id
       LEFT JOIN media_assets a ON a.id = mat.media_id AND a.kind = 'video'
       WHERE t.slug = ? COLLATE NOCASE ${options.includeHidden ? "" : "AND t.is_visible = 1"}
       GROUP BY t.id`,
    )
    .get(slug) as VideoTagRow | undefined;
  return row ? toVideoTag(row) : null;
}

export function createVideoTag(nameValue: unknown, descriptionValue: unknown = ""): VideoTag {
  const name = normalizeVideoTagName(nameValue);
  const description = normalizeVideoTagDescription(descriptionValue);
  if (!name || description === null) {
    throw new MediaTagError("标签名称应为 1 到 40 个字符，描述不能超过 500 个字符");
  }
  const db = getDb();
  if (db.prepare("SELECT id FROM video_tags WHERE name = ? COLLATE NOCASE").get(name)) {
    throw new MediaTagError("同名视频标签已存在");
  }
  const sortOrder = Number((db.prepare("SELECT COALESCE(MAX(sort_order), -10) + 10 AS value FROM video_tags").get() as { value: number }).value);
  const result = db
    .prepare("INSERT INTO video_tags (name, slug, description, sort_order) VALUES (?, ?, ?, ?)")
    .run(name, nextVideoTagSlug(name), description, sortOrder);
  return listVideoTags({ includeHidden: true, pageSize: 5_000 }).tags.find((tag) => tag.id === Number(result.lastInsertRowid))!;
}

export function updateVideoTag(
  id: number,
  nameValue: unknown,
  descriptionValue: unknown,
  sortOrder: number,
  visible: boolean,
): boolean {
  if (!Number.isInteger(id) || id <= 0) return false;
  const name = normalizeVideoTagName(nameValue);
  const description = normalizeVideoTagDescription(descriptionValue);
  if (!name || description === null) {
    throw new MediaTagError("标签名称应为 1 到 40 个字符，描述不能超过 500 个字符");
  }
  const db = getDb();
  if (db.prepare("SELECT id FROM video_tags WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, id)) {
    throw new MediaTagError("同名视频标签已存在");
  }
  return Number(db.prepare(
    "UPDATE video_tags SET name = ?, description = ?, sort_order = ?, is_visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(name, description, normalizeVideoCategorySortOrder(sortOrder), visible ? 1 : 0, id).changes) > 0;
}

export function deleteVideoTag(id: number): boolean {
  return Number.isInteger(id) && id > 0
    ? Number(getDb().prepare("DELETE FROM video_tags WHERE id = ?").run(id).changes) > 0
    : false;
}

export function listVideoTagsForAssets(assetIds: number[]): Record<number, VideoTag[]> {
  const ids = Array.from(new Set(assetIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) return {};
  const rows = getDb()
    .prepare(
      `SELECT mat.media_id, t.id, t.name, t.slug, t.description, t.sort_order, t.is_visible,
              t.created_at, t.updated_at, 0 AS video_count
       FROM media_asset_tags mat
       JOIN video_tags t ON t.id = mat.tag_id
       WHERE mat.media_id IN (${ids.map(() => "?").join(", ")})
       ORDER BY t.sort_order ASC, natural_sort_key(t.name) ASC, t.name COLLATE NOCASE ASC, t.id ASC`,
    )
    .all(...ids) as MediaVideoTagRow[];
  const result: Record<number, VideoTag[]> = {};
  for (const row of rows) {
    (result[row.media_id] ||= []).push(toVideoTag(row));
  }
  return result;
}

export function listVideoTagsForAsset(assetId: number): VideoTag[] {
  return listVideoTagsForAssets([assetId])[assetId] || [];
}

export function setVideoTagsForAssets(assetIds: number[], tagIds: number[]): number {
  const ids = Array.from(new Set(assetIds.filter((id) => Number.isInteger(id) && id > 0)));
  const tags = Array.from(new Set(tagIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) return 0;
  const db = getDb();
  const videos = db
    .prepare(`SELECT id FROM media_assets WHERE kind = 'video' AND id IN (${ids.map(() => "?").join(", ")})`)
    .all(...ids) as Array<{ id: number }>;
  if (tags.length) {
    const found = db
      .prepare(`SELECT id FROM video_tags WHERE id IN (${tags.map(() => "?").join(", ")})`)
      .all(...tags) as Array<{ id: number }>;
    if (found.length !== tags.length) throw new MediaTagError("所选视频标签不存在");
  }
  db.exec("BEGIN");
  try {
    const remove = db.prepare("DELETE FROM media_asset_tags WHERE media_id = ?");
    const insert = db.prepare("INSERT INTO media_asset_tags (media_id, tag_id) VALUES (?, ?)");
    const touch = db.prepare("UPDATE media_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    for (const video of videos) {
      remove.run(video.id);
      for (const tagId of tags) insert.run(video.id, tagId);
      touch.run(video.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return videos.length;
}

export function listVideoCategories(options: { includeHidden?: boolean } = {}): VideoCategory[] {
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.sort_order, c.is_visible, c.created_at, c.updated_at,
              COUNT(a.id) AS video_count
       FROM video_categories c
       LEFT JOIN media_assets a ON a.category_id = c.id AND a.kind = 'video'
       ${options.includeHidden ? "" : "WHERE c.is_visible = 1"}
       GROUP BY c.id
       ORDER BY c.sort_order ASC, c.name COLLATE NOCASE ASC, c.id ASC`,
    )
    .all() as VideoCategoryRow[];
  return rows.map(toVideoCategory);
}

export function resolveVideoCategoryId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new MediaCategoryError("视频分类无效");
  }
  const found = getDb().prepare("SELECT id FROM video_categories WHERE id = ?").get(id) as { id: number } | undefined;
  if (!found) {
    throw new MediaCategoryError("视频分类不存在");
  }
  return id;
}

export function createVideoCategory(nameValue: string, sortOrder?: number, visible = true): VideoCategory {
  const name = normalizeVideoCategoryName(nameValue);
  if (!name) {
    throw new MediaCategoryError("分类名称应为 1 到 24 个字符");
  }
  const duplicate = getDb().prepare("SELECT id FROM video_categories WHERE name = ? COLLATE NOCASE").get(name) as { id: number } | undefined;
  if (duplicate) {
    throw new MediaCategoryError("同名视频分类已存在");
  }
  const nextOrder = sortOrder === undefined
    ? Number((getDb().prepare("SELECT COALESCE(MAX(sort_order), -10) + 10 AS value FROM video_categories").get() as { value: number }).value)
    : normalizeVideoCategorySortOrder(sortOrder);
  const result = getDb()
    .prepare("INSERT INTO video_categories (name, sort_order, is_visible) VALUES (?, ?, ?)")
    .run(name, nextOrder, visible ? 1 : 0);
  return listVideoCategories({ includeHidden: true }).find((category) => category.id === Number(result.lastInsertRowid))!;
}

export function updateVideoCategory(id: number, nameValue: string, sortOrder: number, visible: boolean): boolean {
  if (!Number.isInteger(id) || id <= 0) {
    return false;
  }
  const name = normalizeVideoCategoryName(nameValue);
  if (!name) {
    throw new MediaCategoryError("分类名称应为 1 到 24 个字符");
  }
  const duplicate = getDb()
    .prepare("SELECT id FROM video_categories WHERE name = ? COLLATE NOCASE AND id <> ?")
    .get(name, id) as { id: number } | undefined;
  if (duplicate) {
    throw new MediaCategoryError("同名视频分类已存在");
  }
  const result = getDb()
    .prepare("UPDATE video_categories SET name = ?, sort_order = ?, is_visible = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(name, normalizeVideoCategorySortOrder(sortOrder), visible ? 1 : 0, id);
  return Number(result.changes) > 0;
}

export function deleteVideoCategory(id: number): boolean {
  return Number.isInteger(id) && id > 0
    ? Number(getDb().prepare("DELETE FROM video_categories WHERE id = ?").run(id).changes) > 0
    : false;
}

export function setVideoCategoryForAssets(ids: number[], categoryValue: unknown): number {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) {
    return 0;
  }
  const categoryId = resolveVideoCategoryId(categoryValue);
  const placeholders = uniqueIds.map(() => "?").join(", ");
  return Number(
    getDb()
      .prepare(`UPDATE media_assets SET category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE kind = 'video' AND id IN (${placeholders})`)
      .run(categoryId, ...uniqueIds).changes,
  );
}

export function isMediaKind(value: unknown): value is MediaKind {
  return value === "video" || value === "audio" || value === "file";
}

export function isFeedbackMediaKind(kind: MediaKind): kind is FeedbackMediaKind {
  return kind === "video" || kind === "audio";
}

export function isMediaKindEnabled(kind: MediaKind): boolean {
  if (kind === "video") {
    return isVideoLibraryEnabled();
  }
  if (kind === "audio") {
    return isAudioLibraryEnabled();
  }
  return isFileLibraryEnabled();
}

export function isMediaKindPublic(kind: MediaKind): boolean {
  return canBrowseHomePortalContent(kind, false);
}

export function isMediaKindAccessible(kind: MediaKind, authenticated: boolean): boolean {
  return canBrowseHomePortalContent(kind, authenticated);
}

export function isMediaKindEntryVisible(kind: MediaKind, authenticated: boolean): boolean {
  return canSeeHomePortalContentEntry(kind, authenticated);
}

export function isMediaKindConsumable(kind: MediaKind, authenticated: boolean): boolean {
  return canConsumeHomePortalContent(kind, authenticated);
}

export function isMediaKindContentPublic(kind: MediaKind): boolean {
  return canConsumeHomePortalContent(kind, false);
}

export function hasPublishedMediaHls(
  asset: Pick<MediaAsset, "playbackFormat" | "playbackVersion" | "playbackManifestPath">,
): boolean {
  return asset.playbackFormat === "hls" &&
    Boolean(asset.playbackVersion) &&
    Boolean(asset.playbackManifestPath);
}

export function getAccessibleMediaKinds(authenticated: boolean): MediaKind[] {
  return MEDIA_KINDS.filter((kind) => isMediaKindAccessible(kind, authenticated));
}

export function getVisibleMediaEntryKinds(authenticated: boolean): MediaKind[] {
  return MEDIA_KINDS.filter((kind) => isMediaKindEntryVisible(kind, authenticated));
}

export function normalizeMediaFile(params: {
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  allowVideoConversionSources?: boolean;
}): {
  fileName: string;
  extension: string;
  mimeType: string;
} | null {
  const fileName = path.basename(params.fileName.trim()).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
  if (!fileName) {
    return null;
  }
  const extension = path.extname(fileName).toLowerCase().slice(0, 16);
  const conversionSource = params.kind === "video" && params.allowVideoConversionSources &&
    [".ts", ".mts", ".m2ts"].includes(extension);
  if (params.kind !== "file" && !KIND_EXTENSIONS[params.kind].has(extension) && !conversionSource) {
    return null;
  }
  const suppliedMime = params.mimeType.trim().toLowerCase();
  const mimeType = MEDIA_MIME_TYPES[extension] || (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(suppliedMime) ? suppliedMime : "application/octet-stream");
  return { fileName, extension, mimeType };
}

export function normalizeMediaTitle(value: string, extension = ""): string | null {
  let title = value.trim();
  if (extension && title.toLowerCase().endsWith(extension.toLowerCase())) {
    title = title.slice(0, -extension.length).trim();
  }
  if (
    !title ||
    title.length > 120 ||
    /[<>:"/\\|?*\u0000-\u001f]/.test(title) ||
    /[. ]$/.test(title) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(title)
  ) {
    return null;
  }
  return title;
}

export function createStoredMediaName(extension: string): string {
  return `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension}`;
}

function emptyFolderSnapshot(): MediaLibrarySyncState["folders"] {
  return { video: [], audio: [], file: [] };
}

function getMediaLibrarySyncState(): MediaLibrarySyncState {
  const directory = isRemoteMediaStorage()
    ? `remote:${remoteMediaRegistryFingerprint()}`
    : path.resolve(getMediaDir());
  const globalState = globalThis as MediaGlobal;
  if (!globalState.mediaLibrarySyncState || globalState.mediaLibrarySyncState.directory !== directory) {
    globalState.mediaLibrarySyncState = {
      directory,
      syncedAt: 0,
      prepared: false,
      folders: emptyFolderSnapshot(),
    };
  }
  return globalState.mediaLibrarySyncState;
}

function markMediaLibraryDirty() {
  getMediaLibrarySyncState().syncedAt = 0;
}

function rememberMediaFolder(kind: MediaKind, folder: string) {
  if (!folder) {
    return;
  }
  const state = getMediaLibrarySyncState();
  const known = new Map(state.folders[kind].map((item) => [item.path, item.mtimeMs]));
  const segments = folder.split("/");
  for (let index = 1; index <= segments.length; index += 1) {
    const folderPath = segments.slice(0, index).join("/");
    if (!known.has(folderPath)) {
      known.set(folderPath, Date.now());
    }
  }
  state.folders[kind] = Array.from(known, ([folderPath, mtimeMs]) => ({ path: folderPath, mtimeMs }));
}

function renameRememberedMediaFolder(kind: MediaKind, folder: string, nextFolder: string) {
  const state = getMediaLibrarySyncState();
  state.folders[kind] = state.folders[kind].map((item) => {
    if (item.path === folder) {
      return { ...item, path: nextFolder };
    }
    if (item.path.startsWith(`${folder}/`)) {
      return { ...item, path: `${nextFolder}${item.path.slice(folder.length)}` };
    }
    return item;
  });
  rememberMediaFolder(kind, nextFolder);
}

function forgetMediaFolder(kind: MediaKind, folder: string) {
  const state = getMediaLibrarySyncState();
  state.folders[kind] = state.folders[kind].filter((item) => item.path !== folder && !item.path.startsWith(`${folder}/`));
}

function ensureMediaDirectories() {
  fs.mkdirSync(getMediaDir(), { recursive: true });
  fs.mkdirSync(path.join(getMediaDir(), ".uploads"), { recursive: true });
  fs.mkdirSync(path.join(getMediaDir(), ".thumbnails"), { recursive: true });
  for (const kind of MEDIA_KINDS) {
    fs.mkdirSync(path.join(getMediaDir(), kind), { recursive: true });
  }
}

export function availableMediaStoredName(kind: MediaKind, folder: string, fileName: string, excludeStoredName = ""): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateFileName = suffix === 1 ? fileName : `${baseName} (${suffix})${extension}`;
    const candidate = mediaStoredName(kind, folder, candidateFileName);
    if (candidate === excludeStoredName || !fs.existsSync(mediaFilePath(candidate))) {
      return candidate;
    }
  }
  throw new MediaFolderError("同名资源过多，请修改名称");
}

export function availableIndexedMediaStoredName(
  kind: MediaKind,
  folder: string,
  fileName: string,
): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const exists = getDb().prepare("SELECT 1 FROM media_assets WHERE stored_name = ?");
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidateFileName = suffix === 1 ? fileName : `${baseName} (${suffix})${extension}`;
    const candidate = mediaStoredName(kind, folder, candidateFileName);
    if (!exists.get(candidate)) {
      return candidate;
    }
  }
  throw new MediaFolderError("同名资源过多，请修改名称");
}

function migrateFlatMediaAssets() {
  const rows = getDb().prepare("SELECT id, kind, stored_name FROM media_assets").all() as Array<{
    id: number;
    kind: MediaKind;
    stored_name: string;
  }>;
  const update = getDb().prepare("UPDATE media_assets SET stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
  for (const row of rows) {
    if (toPosixPath(row.stored_name).startsWith(`${row.kind}/`)) {
      continue;
    }
    let destinationStoredName = mediaStoredName(row.kind, "", path.basename(row.stored_name));
    const sourcePath = mediaFilePath(row.stored_name);
    let destinationPath = mediaFilePath(destinationStoredName);
    if (fs.existsSync(sourcePath)) {
      if (fs.existsSync(destinationPath)) {
        const extension = path.extname(row.stored_name).toLowerCase();
        destinationStoredName = mediaStoredName(row.kind, "", createStoredMediaName(extension));
        destinationPath = mediaFilePath(destinationStoredName);
      }
      fs.renameSync(sourcePath, destinationPath);
      update.run(destinationStoredName, row.id);
    } else if (fs.existsSync(destinationPath)) {
      update.run(destinationStoredName, row.id);
    }
  }
}

function migrateGeneratedMediaFileNames() {
  const rows = getDb().prepare("SELECT * FROM media_assets").all() as MediaRow[];
  for (const row of rows) {
    const currentFileName = path.basename(row.stored_name);
    if (!/^\d{10,}-[a-f0-9]{24}\.[^.]+$/i.test(currentFileName)) {
      continue;
    }
    const extension = path.extname(currentFileName);
    const title = normalizeMediaTitle(row.title, extension);
    const sourcePath = mediaFilePath(row.stored_name);
    if (!title || !fs.existsSync(sourcePath)) {
      continue;
    }
    const folder = mediaFolderFromStoredName(row.stored_name, row.kind);
    const nextStoredName = availableMediaStoredName(row.kind, folder, `${title}${extension}`, row.stored_name);
    if (nextStoredName === row.stored_name) {
      continue;
    }
    const nextFileName = path.basename(nextStoredName);
    const nextTitle = path.basename(nextFileName, path.extname(nextFileName));
    const targetPath = mediaFilePath(nextStoredName);
    fs.renameSync(sourcePath, targetPath);
    try {
      getDb().exec("BEGIN");
      getDb()
        .prepare("UPDATE media_assets SET title = ?, file_name = ?, stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(nextTitle, nextFileName, nextStoredName, row.id);
      getDb().prepare("UPDATE user_media_history SET title = ? WHERE media_id = ?").run(nextTitle, row.id);
      getDb().exec("COMMIT");
    } catch (error) {
      getDb().exec("ROLLBACK");
      fs.renameSync(targetPath, sourcePath);
      throw error;
    }
  }
}

async function scanMediaFiles(refreshRemote = false): Promise<ScannedMediaLibrary> {
  if (isRemoteMediaStorage()) {
    const files = new Map<string, ScannedMediaFile>();
    const folders = emptyFolderSnapshot();
    const failures: unknown[] = [];
    let completedNodes = 0;
    for (const node of listRemoteMediaNodes()) {
      let manifest;
      try {
        manifest = await readRemoteMediaManifest(node.id, refreshRemote);
        completedNodes += 1;
      } catch (error) {
        failures.push(error);
        console.warn(`[media] failed to read manifest from node ${node.id}`, error);
        continue;
      }
      for (const file of manifest.files) {
        files.set(mediaStorageKey(node.id, file.storedName), {
          ...file,
          storageNodeId: node.id,
        });
      }
      for (const kind of MEDIA_KINDS) {
        folders[kind].push(
          ...manifest.folders
            .filter((folder) => folder.kind === kind)
            .map(({ path: folderPath, mtimeMs }) => ({ path: folderPath, mtimeMs })),
        );
      }
    }
    if (!completedNodes && failures.length) {
      throw failures[0];
    }
    return {
      files,
      folders,
    };
  }
  const files = new Map<string, ScannedMediaFile>();
  const folders = emptyFolderSnapshot();
  const visit = async (kind: MediaKind, directory: string, relativeFolder = "") => {
    for (const entry of await fs.promises.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || isIgnoredMediaStorageEntry(entry.name)) {
        continue;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const folderPath = [relativeFolder, entry.name].filter(Boolean).join("/");
        const stat = await fs.promises.stat(absolutePath);
        folders[kind].push({ path: folderPath, mtimeMs: Math.floor(stat.mtimeMs) });
        await visit(kind, absolutePath, folderPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const normalizedFile = normalizeMediaFile({ kind, fileName: entry.name, mimeType: "" });
      if (!normalizedFile) {
        continue;
      }
      const stat = await fs.promises.stat(absolutePath);
      const storedName = toPosixPath(path.relative(getMediaDir(), absolutePath));
      files.set(mediaStorageKey(null, storedName), {
        kind,
        storageNodeId: null,
        fileName: normalizedFile.fileName,
        storedName,
        mimeType: normalizedFile.mimeType,
        sizeBytes: stat.size,
        mtimeMs: Math.floor(stat.mtimeMs),
      });
    }
  };

  for (const kind of MEDIA_KINDS) {
    await visit(kind, path.join(getMediaDir(), kind));
  }
  return { files, folders };
}

function removeThumbnailFile(id: number) {
  if (isRemoteMediaStorage()) {
    return;
  }
  const directory = path.join(getMediaDir(), ".thumbnails");
  if (!fs.existsSync(directory)) {
    return;
  }
  for (const fileName of fs.readdirSync(directory)) {
    if (fileName === `${id}.jpg` || fileName.startsWith(`${id}-`)) {
      fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }
}

async function performMediaLibrarySync(state: MediaLibrarySyncState, force = false): Promise<MediaSyncResult> {
  const startedAt = Date.now();
  if (!isRemoteMediaStorage()) {
    ensureMediaDirectories();
  }
  if (!state.prepared && !isRemoteMediaStorage()) {
    migrateFlatMediaAssets();
    migrateGeneratedMediaFileNames();
    state.prepared = true;
  }
  const scannedLibrary = await scanMediaFiles(force);
  const scanned = scannedLibrary.files;
  const db = getDb();
  const rows = db.prepare("SELECT * FROM media_assets").all() as MediaRow[];
  const remoteStorage = isRemoteMediaStorage();
  const scannedByStoredName = new Map<string, ScannedMediaFile[]>();
  for (const file of scanned.values()) {
    scannedByStoredName.set(file.storedName, [
      ...(scannedByStoredName.get(file.storedName) || []),
      file,
    ]);
  }
  const existing = new Map<string, MediaRow>();
  for (const row of rows) {
    let storageNodeId: string | null = null;
    if (remoteStorage) {
      const candidates = (scannedByStoredName.get(row.stored_name) || [])
        .filter((file) => file.kind === row.kind);
      storageNodeId = row.storage_node_id ||
        (candidates.length === 1
          ? candidates[0].storageNodeId
          : resolveRemoteMediaNodeForAsset(null, row.kind).id);
    }
    existing.set(mediaStorageKey(storageNodeId, row.stored_name), row);
  }
  const missingRows = remoteStorage ? [] : rows.filter((row) => {
    if (scanned.has(mediaStorageKey(null, row.stored_name))) {
      return false;
    }
    const canonicalManifest = row.playback_manifest_path
      ? resolvePlaybackHlsFile(getMediaDir(), row.playback_manifest_path, "index.m3u8")
      : null;
    if (
      row.kind === "video" &&
      row.playback_format === "hls" &&
      Boolean(row.playback_version) &&
      canonicalManifest &&
      fs.existsSync(canonicalManifest)
    ) {
      return false;
    }
    try {
      return !fs.existsSync(mediaFilePath(row.stored_name));
    } catch {
      return true;
    }
  });
  const newFiles = Array.from(scanned.values()).filter(
    (file) => !existing.has(mediaStorageKey(file.storageNodeId, file.storedName)),
  );
  const identity = (item: { kind: MediaKind; sizeBytes?: number; size_bytes?: number; mtimeMs?: number; mtime_ms?: number; fileName?: string; file_name?: string }) => {
    const size = item.sizeBytes ?? item.size_bytes ?? -1;
    const mtime = item.mtimeMs ?? item.mtime_ms ?? -1;
    const fileName = item.fileName ?? item.file_name ?? "";
    return `${item.kind}:${size}:${mtime}:${path.extname(fileName).toLowerCase()}`;
  };
  const missingByIdentity = new Map<string, MediaRow[]>();
  const newByIdentity = new Map<string, ScannedMediaFile[]>();
  for (const row of missingRows) {
    const key = identity(row);
    missingByIdentity.set(key, [...(missingByIdentity.get(key) || []), row]);
  }
  for (const file of newFiles) {
    const key = identity(file);
    newByIdentity.set(key, [...(newByIdentity.get(key) || []), file]);
  }
  const renamedPairs: Array<{ row: MediaRow; file: ScannedMediaFile }> = [];
  for (const [key, oldRows] of missingByIdentity) {
    const nextFiles = newByIdentity.get(key) || [];
    if (oldRows.length === 1 && nextFiles.length === 1 && oldRows[0].mtime_ms > 0) {
      renamedPairs.push({ row: oldRows[0], file: nextFiles[0] });
    }
  }
  const renamedIds = new Set(renamedPairs.map((pair) => pair.row.id));
  const renamedStorageKeys = new Set(
    renamedPairs.map((pair) => mediaStorageKey(pair.file.storageNodeId, pair.file.storedName)),
  );
  const removedRows = missingRows.filter((row) => !renamedIds.has(row.id));
  let added = 0;
  let updated = 0;
  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      `INSERT INTO media_assets (
         kind, storage_node_id, title, artist, description, file_name, stored_name,
         mime_type, size_bytes, mtime_ms
       )
       VALUES (?, ?, ?, '', '', ?, ?, ?, ?, ?)`,
    );
    const update = db.prepare(
      `UPDATE media_assets
       SET storage_node_id = ?, title = ?, file_name = ?, mime_type = ?, size_bytes = ?, mtime_ms = ?,
           duration_seconds = CASE WHEN size_bytes <> ? OR mtime_ms <> ? THEN NULL ELSE duration_seconds END,
           thumbnail_version = CASE WHEN size_bytes <> ? OR mtime_ms <> ? THEN 0 ELSE thumbnail_version END,
           playback_status = CASE WHEN size_bytes <> ? OR mtime_ms <> ? THEN
             CASE
               WHEN playback_format = 'hls' AND playback_manifest_path IS NOT NULL AND playback_version <> '' THEN 'ready'
               ELSE 'none'
             END
             ELSE playback_status
           END,
           playback_error = CASE WHEN size_bytes <> ? OR mtime_ms <> ? THEN '' ELSE playback_error END,
           content_updated_at = CASE WHEN size_bytes <> ? OR mtime_ms <> ? THEN CURRENT_TIMESTAMP ELSE content_updated_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    const updateRename = db.prepare(
      `UPDATE media_assets
       SET title = ?, file_name = ?, stored_name = ?, mime_type = ?, size_bytes = ?, mtime_ms = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    );
    const updateHistoryTitle = db.prepare("UPDATE user_media_history SET title = ? WHERE media_id = ?");
    const deleteObsoletePlaybackJob = db.prepare(
      "DELETE FROM media_playback_jobs WHERE media_id = ? AND source_version <> ?",
    );
    const claimedStoredNames = new Set(rows.map((row) => row.stored_name));
    for (const { row, file } of renamedPairs) {
      const title = path.basename(file.fileName, path.extname(file.fileName));
      updateRename.run(title, file.fileName, file.storedName, file.mimeType, file.sizeBytes, file.mtimeMs, row.id);
      updateHistoryTitle.run(title, row.id);
      updated += 1;
    }
    for (const file of scanned.values()) {
      const storageKey = mediaStorageKey(file.storageNodeId, file.storedName);
      const row = existing.get(storageKey);
      if (!row && !renamedStorageKeys.has(storageKey)) {
        if (claimedStoredNames.has(file.storedName)) {
          console.warn(
            `[media] skipped duplicate logical path on node ${file.storageNodeId || "local"}: ${file.storedName}`,
          );
          continue;
        }
        insert.run(
          file.kind,
          file.storageNodeId,
          path.basename(file.fileName, path.extname(file.fileName)),
          file.fileName,
          file.storedName,
          file.mimeType,
          file.sizeBytes,
          file.mtimeMs,
        );
        claimedStoredNames.add(file.storedName);
        added += 1;
      } else if (row && (
        row.storage_node_id !== file.storageNodeId ||
        row.file_name !== file.fileName ||
        row.mime_type !== file.mimeType ||
        row.size_bytes !== file.sizeBytes ||
        row.mtime_ms !== file.mtimeMs
      )) {
        const sourceChanged = row.size_bytes !== file.sizeBytes || row.mtime_ms !== file.mtimeMs;
        const title = row.file_name === file.fileName ? row.title : path.basename(file.fileName, path.extname(file.fileName));
        update.run(
          file.storageNodeId,
          title,
          file.fileName,
          file.mimeType,
          file.sizeBytes,
          file.mtimeMs,
          file.sizeBytes,
          file.mtimeMs,
          file.sizeBytes,
          file.mtimeMs,
          file.sizeBytes,
          file.mtimeMs,
          file.sizeBytes,
          file.mtimeMs,
          file.sizeBytes,
          file.mtimeMs,
          row.id,
        );
        if (row.kind === "video" && sourceChanged) {
          deleteObsoletePlaybackJob.run(
            row.id,
            `${Math.max(0, Math.floor(file.mtimeMs))}-${Math.max(0, Math.floor(file.sizeBytes))}`,
          );
        }
        if (title !== row.title) {
          updateHistoryTitle.run(title, row.id);
        }
        updated += 1;
      }
    }
    if (removedRows.length) {
      const placeholders = removedRows.map(() => "?").join(", ");
      db.prepare(`DELETE FROM media_assets WHERE id IN (${placeholders})`).run(...removedRows.map((row) => row.id));
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  for (const row of removedRows) {
    removeThumbnailFile(row.id);
    if (row.kind === "video" && !isRemoteMediaStorage()) {
      removePlaybackHlsVersions(getMediaDir(), row.id);
    }
    await deleteMediaCustomCover(
      { kind: row.kind, storageNodeId: row.storage_node_id },
      row.custom_cover_key,
    ).catch((error) => {
      console.warn(`[media] failed to delete orphaned custom cover for asset ${row.id}`, error);
    });
  }
  state.folders = scannedLibrary.folders;
  state.syncedAt = Date.now();
  const result = { added, updated, removed: removedRows.length };
  const elapsedMs = state.syncedAt - startedAt;
  if (elapsedMs >= 1_000 || added || updated || removedRows.length) {
    console.info(`[media] library sync ${elapsedMs}ms: +${added} ~${updated} -${removedRows.length}`);
  }
  return result;
}

export function syncMediaLibrary(options: { force?: boolean } = {}): Promise<MediaSyncResult> {
  const state = getMediaLibrarySyncState();
  const now = Date.now();
  if (state.running) {
    return state.running;
  }
  if (!options.force && now - state.syncedAt < MEDIA_SYNC_INTERVAL_MS) {
    return Promise.resolve({ added: 0, updated: 0, removed: 0 });
  }

  const job = performMediaLibrarySync(state, Boolean(options.force));
  state.running = job;
  void job.finally(() => {
    if (state.running === job) {
      delete state.running;
    }
  }).catch(() => undefined);
  return job;
}

export function createMediaAsset(params: {
  kind: MediaKind;
  storageNodeId?: string | null;
  categoryId?: unknown;
  title: string;
  artist?: string;
  description?: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  mtimeMs?: number;
  durationSeconds?: number | null;
}): MediaAsset {
  const categoryId = params.kind === "video" ? resolveVideoCategoryId(params.categoryId) : null;
  const result = getDb()
    .prepare(
      `INSERT INTO media_assets (
         kind, storage_node_id, category_id, title, artist, description, file_name, stored_name,
         mime_type, size_bytes, mtime_ms, duration_seconds
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      params.kind,
      params.storageNodeId || null,
      categoryId,
      params.title,
      params.kind === "audio" ? params.artist || "" : "",
      params.description || "",
      params.fileName,
      params.storedName,
      params.mimeType,
      params.sizeBytes,
      params.mtimeMs || 0,
      params.durationSeconds && params.durationSeconds > 0 ? params.durationSeconds : null,
    );
  return getMediaAsset(Number(result.lastInsertRowid))!;
}

export function getMediaAsset(id: number): MediaAsset | null {
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  const row = getDb().prepare("SELECT * FROM media_assets WHERE id = ?").get(id) as MediaRow | undefined;
  return row ? toAsset(row) : null;
}

export function getMediaAssetByStoredName(
  storedNameValue: string,
  storageNodeId?: string | null,
): MediaAsset | null {
  const storedName = normalizeMediaFolder(storedNameValue);
  if (!storedName) return null;
  const row = storageNodeId === undefined
    ? getDb().prepare("SELECT * FROM media_assets WHERE stored_name = ?").get(storedName) as MediaRow | undefined
    : getDb()
      .prepare(
        storageNodeId
          ? "SELECT * FROM media_assets WHERE stored_name = ? AND storage_node_id = ?"
          : "SELECT * FROM media_assets WHERE stored_name = ? AND storage_node_id IS NULL",
      )
      .get(...(storageNodeId ? [storedName, storageNodeId] : [storedName])) as MediaRow | undefined;
  return row ? toAsset(row) : null;
}

export function listMediaAssetsByIds(assetIds: number[]): MediaAsset[] {
  const ids = Array.from(new Set(assetIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!ids.length) {
    return [];
  }
  const rows = getDb()
    .prepare(`SELECT * FROM media_assets WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .all(...ids) as MediaRow[];
  const byId = new Map(rows.map((row) => [row.id, toAsset(row)]));
  return ids.flatMap((id) => {
    const asset = byId.get(id);
    return asset ? [asset] : [];
  });
}

function addFolderFilter(filters: string[], values: Array<string | number>, kind: MediaKind, folder: string, recursive: boolean) {
  const prefix = `${kind}/${folder ? `${folder}/` : ""}`;
  filters.push("stored_name LIKE ? ESCAPE '\\'");
  values.push(`${escapeLike(prefix)}%`);
  if (!recursive) {
    filters.push("instr(substr(stored_name, ?), '/') = 0");
    values.push(prefix.length + 1);
  }
}

export function normalizeMediaSortBy(value: string | undefined): MediaSortBy {
  return value === "published" || value === "duration" || value === "size" || value === "updated" || value === "plays" ? value : "name";
}

export function normalizeMediaSortOrder(value: string | undefined, sortBy: MediaSortBy): MediaSortOrder {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return sortBy === "name" ? "asc" : "desc";
}

function mediaAssetOrderBy(sortBy: MediaSortBy, sortOrder: MediaSortOrder): string {
  const direction = sortOrder === "asc" ? "ASC" : "DESC";
  if (sortBy === "name") {
    return `natural_sort_key(title) ${direction}, title COLLATE NOCASE ${direction},
            natural_sort_key(file_name) ${direction}, file_name COLLATE NOCASE ${direction}, id ${direction}`;
  }
  if (sortBy === "size") {
    return `size_bytes ${direction}, title COLLATE NOCASE ASC, id ASC`;
  }
  if (sortBy === "duration") {
    return `CASE WHEN duration_seconds IS NULL OR duration_seconds <= 0 THEN 1 ELSE 0 END ASC,
            duration_seconds ${direction}, title COLLATE NOCASE ASC, id ASC`;
  }
  if (sortBy === "plays") {
    return `play_count ${direction}, title COLLATE NOCASE ASC, id ASC`;
  }
  if (sortBy === "published") {
    return `published_at ${direction}, id ${direction}`;
  }
  return `updated_at ${direction}, id ${direction}`;
}

export function sortMediaFolders(folders: MediaFolder[], sortBy: MediaSortBy, sortOrder: MediaSortOrder): MediaFolder[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  return [...folders].sort((left, right) => {
    let compared = 0;
    if (sortBy === "size") {
      compared = left.totalSizeBytes - right.totalSizeBytes;
    } else if (sortBy === "duration") {
      compared = left.totalAssets - right.totalAssets;
    } else if (sortBy === "updated") {
      compared = left.mtimeMs - right.mtimeMs;
    } else {
      compared = left.name.localeCompare(right.name, "zh-CN", { numeric: true });
    }
    return compared ? compared * direction : left.name.localeCompare(right.name, "zh-CN", { numeric: true });
  });
}

export function listMediaAssets(params: {
  kind?: MediaKind;
  videoCategoryId?: number | null;
  videoTagId?: number;
  folder?: string;
  recursive?: boolean;
  query?: string;
  page?: number;
  pageSize?: number;
  sortBy?: MediaSortBy;
  sortOrder?: MediaSortOrder;
} = {}): { assets: MediaAsset[]; page: number; totalPages: number; totalAssets: number; query: string; folder: string } {
  const query = (params.query || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 100);
  const queryTerms = query.split(" ").filter(Boolean).slice(0, 8);
  const pageSize = Math.min(Math.max(Math.floor(params.pageSize || 18), 1), 100);
  const sortBy = normalizeMediaSortBy(params.sortBy);
  const sortOrder = normalizeMediaSortOrder(params.sortOrder, sortBy);
  const folder = params.kind ? normalizeMediaFolder(params.folder || "") || "" : "";
  const filters: string[] = [];
  const values: Array<string | number> = [];
  if (params.kind) {
    filters.push("kind = ?");
    values.push(params.kind);
    addFolderFilter(filters, values, params.kind, folder, Boolean(params.recursive || query));
  }
  if (params.kind === "video" && params.videoCategoryId !== undefined) {
    if (params.videoCategoryId === null) {
      filters.push("category_id IS NULL");
    } else {
      filters.push("category_id = ?");
      values.push(resolveVideoCategoryId(params.videoCategoryId)!);
    }
  }
  if (params.kind === "video" && params.videoTagId !== undefined) {
    filters.push("EXISTS (SELECT 1 FROM media_asset_tags mat WHERE mat.media_id = media_assets.id AND mat.tag_id = ?)");
    values.push(params.videoTagId);
  }
  for (const term of queryTerms) {
    const escaped = `%${escapeLike(term)}%`;
    if (params.kind === "video") {
      filters.push("(title LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR stored_name LIKE ? ESCAPE '\\')");
      values.push(escaped, escaped, escaped, escaped);
    } else {
      filters.push("(title LIKE ? ESCAPE '\\' OR file_name LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR stored_name LIKE ? ESCAPE '\\')");
      values.push(escaped, escaped, escaped, escaped, escaped);
    }
  }
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const count = getDb().prepare(`SELECT COUNT(*) AS count FROM media_assets ${where}`).get(...values) as { count: number };
  const totalPages = Math.max(1, Math.ceil(count.count / pageSize));
  const page = Math.min(Math.max(Math.floor(params.page || 1), 1), totalPages);
  const rows = getDb()
    .prepare(`SELECT * FROM media_assets ${where} ORDER BY ${mediaAssetOrderBy(sortBy, sortOrder)} LIMIT ? OFFSET ?`)
    .all(...values, pageSize, (page - 1) * pageSize) as MediaRow[];
  return { assets: rows.map(toAsset), page, totalPages, totalAssets: count.count, query, folder };
}

export function listMediaFolders(kind: MediaKind): MediaFolder[] {
  const paths = new Map(getMediaLibrarySyncState().folders[kind].map((item) => [item.path, item.mtimeMs]));
  const directCounts = new Map<string, number>();
  const aggregates = new Map<string, { totalAssets: number; totalSizeBytes: number; mtimeMs: number }>();
  const rows = getDb()
    .prepare("SELECT stored_name, size_bytes, mtime_ms FROM media_assets WHERE kind = ?")
    .all(kind) as Array<{ stored_name: string; size_bytes: number; mtime_ms: number }>;
  for (const row of rows) {
    const folder = mediaFolderFromStoredName(row.stored_name, kind);
    directCounts.set(folder, (directCounts.get(folder) || 0) + 1);
    const segments = folder ? folder.split("/") : [];
    for (let index = 1; index <= segments.length; index += 1) {
      const ancestor = segments.slice(0, index).join("/");
      paths.set(ancestor, Math.max(paths.get(ancestor) || 0, row.mtime_ms));
      const aggregate = aggregates.get(ancestor) || { totalAssets: 0, totalSizeBytes: 0, mtimeMs: 0 };
      aggregate.totalAssets += 1;
      aggregate.totalSizeBytes += row.size_bytes;
      aggregate.mtimeMs = Math.max(aggregate.mtimeMs, row.mtime_ms);
      aggregates.set(ancestor, aggregate);
    }
  }

  return Array.from(paths, ([folderPath, mtimeMs]) => ({ folderPath, mtimeMs }))
    .sort((left, right) => left.folderPath.localeCompare(right.folderPath, "zh-CN", { numeric: true }))
    .map(({ folderPath, mtimeMs }) => ({
      path: folderPath,
      name: folderPath.split("/").at(-1) || folderPath,
      depth: folderPath.split("/").length - 1,
      directAssets: directCounts.get(folderPath) || 0,
      totalAssets: aggregates.get(folderPath)?.totalAssets || 0,
      totalSizeBytes: aggregates.get(folderPath)?.totalSizeBytes || 0,
      mtimeMs: Math.max(mtimeMs, aggregates.get(folderPath)?.mtimeMs || 0),
    }));
}

export function listMediaFolderAssets(kind: MediaKind, folder: string, limit = 1_000): MediaAsset[] {
  const normalizedFolder = normalizeMediaFolder(folder) || "";
  const filters = ["kind = ?"];
  const values: Array<string | number> = [kind];
  addFolderFilter(filters, values, kind, normalizedFolder, false);
  const rows = getDb()
    .prepare(`SELECT * FROM media_assets WHERE ${filters.join(" AND ")} ORDER BY title COLLATE NOCASE ASC, id ASC LIMIT ?`)
    .all(...values, Math.min(Math.max(Math.floor(limit), 1), 2_000)) as MediaRow[];
  return rows.map(toAsset);
}

export function listRelatedVideoAssets(currentId: number, count: number, mode: "next" | "random"): MediaAsset[] {
  const limit = Math.min(Math.max(Math.floor(count), 0), 20);
  if (!limit) {
    return [];
  }
  const rows = mode === "random"
    ? getDb().prepare("SELECT * FROM media_assets WHERE kind = 'video' AND id <> ? ORDER BY RANDOM() LIMIT ?").all(currentId, limit) as MediaRow[]
    : getDb()
      .prepare(
        `SELECT * FROM media_assets
         WHERE kind = 'video' AND id <> ?
         ORDER BY CASE WHEN id > ? THEN 0 ELSE 1 END, id ASC
         LIMIT ?`,
      )
      .all(currentId, currentId, limit) as MediaRow[];
  return rows.map(toAsset);
}

export function saveMediaDuration(id: number, durationSeconds: number): boolean {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return false;
  }
  const info = getDb()
    .prepare("UPDATE media_assets SET duration_seconds = ? WHERE id = ?")
    .run(durationSeconds, id);
  return Number(info.changes) > 0;
}

export function saveMediaThumbnailVersion(id: number, sourceVersion: number): boolean {
  if (!Number.isFinite(sourceVersion) || sourceVersion <= 0) {
    return false;
  }
  const info = getDb()
    .prepare("UPDATE media_assets SET thumbnail_version = ? WHERE id = ?")
    .run(Math.floor(sourceVersion), id);
  return Number(info.changes) > 0;
}

export function replaceMediaCustomCoverKey(id: number, nextKey: string | null): string | null | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT custom_cover_key FROM media_assets WHERE id = ? AND kind = 'video'")
    .get(id) as { custom_cover_key: string | null } | undefined;
  if (!row) {
    return undefined;
  }
  db.prepare(
    "UPDATE media_assets SET custom_cover_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
  ).run(nextKey, id);
  return row.custom_cover_key;
}

export function mediaThumbnailVersion(sourceVersion: number, percent: number): number {
  const normalizedPercent = Math.min(Math.max(Math.floor(percent), 1), 99);
  return Math.floor(sourceVersion) * 100 + normalizedPercent;
}

export function listMediaAssetsNeedingPreparation(limit = 1_000, thumbnailPercent = 33): MediaAsset[] {
  const normalizedPercent = Math.min(Math.max(Math.floor(thumbnailPercent), 1), 99);
  const rows = getDb()
    .prepare(
      `SELECT * FROM media_assets
       WHERE (
         kind = 'audio'
         AND (duration_seconds IS NULL OR duration_seconds <= 0)
       ) OR (
         kind = 'video'
         AND playback_format <> 'hls'
         AND playback_status <> 'processing'
         AND (
           duration_seconds IS NULL OR duration_seconds <= 0
           OR thumbnail_version <> CAST(mtime_ms AS INTEGER) * 100 + ?
         )
       )
       ORDER BY updated_at DESC, id ASC
       LIMIT ?`,
    )
    .all(normalizedPercent, Math.min(Math.max(Math.floor(limit), 1), 5_000)) as MediaRow[];
  return rows.map(toAsset);
}

function mediaFolderAbsolutePath(kind: MediaKind, folder: string): string {
  const normalizedFolder = normalizeMediaFolder(folder);
  if (normalizedFolder === null) {
    throw new MediaFolderError("文件夹路径无效");
  }
  return mediaFilePath([kind, normalizedFolder].filter(Boolean).join("/"));
}

export function mediaFolderExists(kind: MediaKind, folder: string): boolean {
  ensureMediaDirectories();
  try {
    return fs.statSync(mediaFolderAbsolutePath(kind, folder)).isDirectory();
  } catch {
    return false;
  }
}

export async function createMediaFolder(kind: MediaKind, parent: string, nameValue: string): Promise<string> {
  const normalizedParent = normalizeMediaFolder(parent);
  const name = normalizeFolderName(nameValue);
  if (normalizedParent === null || !name) {
    throw new MediaFolderError("文件夹名称无效");
  }
  const folder = [normalizedParent, name].filter(Boolean).join("/");
  if (isRemoteMediaStorage()) {
    try {
      const node = getRemoteMediaNodeForKind(kind);
      const createdFolder = await createRemoteMediaFolder(node.id, kind, folder);
      markMediaLibraryDirty();
      rememberMediaFolder(kind, createdFolder);
      return createdFolder;
    } catch (error) {
      remoteMediaError(error);
    }
  }
  ensureMediaDirectories();
  const parentPath = mediaFolderAbsolutePath(kind, normalizedParent);
  if (!fs.statSync(parentPath).isDirectory()) {
    throw new MediaFolderError("上级文件夹不存在");
  }
  const targetPath = mediaFolderAbsolutePath(kind, folder);
  if (fs.existsSync(targetPath)) {
    throw new MediaFolderError("文件夹已存在");
  }
  fs.mkdirSync(targetPath);
  markMediaLibraryDirty();
  rememberMediaFolder(kind, folder);
  return folder;
}

export async function renameMediaFolder(kind: MediaKind, folderValue: string, nameValue: string): Promise<string> {
  const folder = normalizeMediaFolder(folderValue);
  const name = normalizeFolderName(nameValue);
  if (!folder || !name) {
    throw new MediaFolderError("文件夹名称无效");
  }
  const segments = folder.split("/");
  const parent = segments.slice(0, -1).join("/");
  const nextFolder = [parent, name].filter(Boolean).join("/");
  if (nextFolder === folder) {
    return folder;
  }
  const oldPrefix = `${kind}/${folder}/`;
  const nextPrefix = `${kind}/${nextFolder}/`;
  const remoteStorage = isRemoteMediaStorage();
  const remoteNode = remoteStorage ? getRemoteMediaNodeForKind(kind) : null;
  const includeUnassignedRows = remoteNode
    ? resolveRemoteMediaNodeForAsset(null, kind).id === remoteNode.id
    : false;
  const rows = getDb()
    .prepare(
      `SELECT id, stored_name FROM media_assets
       WHERE stored_name LIKE ? ESCAPE '\\'
       ${remoteNode
          ? `AND (storage_node_id = ?${includeUnassignedRows ? " OR storage_node_id IS NULL" : ""})`
          : ""}`,
    )
    .all(...(remoteNode ? [`${escapeLike(oldPrefix)}%`, remoteNode.id] : [`${escapeLike(oldPrefix)}%`])) as Array<{
    id: number;
    stored_name: string;
  }>;
  const sourcePath = remoteStorage ? "" : mediaFolderAbsolutePath(kind, folder);
  const targetPath = remoteStorage ? "" : mediaFolderAbsolutePath(kind, nextFolder);
  if (remoteStorage) {
    try {
      await renameRemoteMediaFolder(remoteNode!.id, kind, folder, nextFolder);
    } catch (error) {
      remoteMediaError(error);
    }
  } else {
    if (!fs.existsSync(sourcePath)) {
      throw new MediaFolderError("文件夹不存在");
    }
    if (fs.existsSync(targetPath)) {
      throw new MediaFolderError("同名文件夹已存在");
    }
    fs.renameSync(sourcePath, targetPath);
  }
  const db = getDb();
  db.exec("BEGIN");
  try {
    const update = db.prepare("UPDATE media_assets SET stored_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    for (const row of rows) {
      update.run(`${nextPrefix}${row.stored_name.slice(oldPrefix.length)}`, row.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    if (remoteStorage) {
      await renameRemoteMediaFolder(remoteNode!.id, kind, nextFolder, folder).catch(() => undefined);
    } else {
      fs.renameSync(targetPath, sourcePath);
    }
    throw error;
  }
  markMediaLibraryDirty();
  renameRememberedMediaFolder(kind, folder, nextFolder);
  return nextFolder;
}

export async function deleteMediaFolder(kind: MediaKind, folderValue: string): Promise<boolean> {
  const folder = normalizeMediaFolder(folderValue);
  if (!folder) {
    throw new MediaFolderError("不能删除分类根目录");
  }
  if (isRemoteMediaStorage()) {
    try {
      const node = getRemoteMediaNodeForKind(kind);
      const deleted = await deleteRemoteMediaFolder(node.id, kind, folder);
      if (deleted) {
        markMediaLibraryDirty();
        forgetMediaFolder(kind, folder);
      }
      return deleted;
    } catch (error) {
      remoteMediaError(error);
    }
  }
  const targetPath = mediaFolderAbsolutePath(kind, folder);
  if (!fs.existsSync(targetPath)) {
    return false;
  }
  if (fs.readdirSync(targetPath).length) {
    throw new MediaFolderError("只能删除空文件夹");
  }
  fs.rmdirSync(targetPath);
  markMediaLibraryDirty();
  forgetMediaFolder(kind, folder);
  return true;
}

export async function updateMediaAsset(
  id: number,
  titleValue: string,
  artist: string,
  description: string,
  folderValue?: string,
  categoryValue?: unknown,
): Promise<boolean> {
  const asset = getMediaAsset(id);
  if (!asset) {
    return false;
  }
  const extension = path.extname(asset.fileName);
  const title = normalizeMediaTitle(titleValue, extension);
  const folder = normalizeMediaFolder(folderValue ?? asset.folder);
  if (!title) {
    throw new MediaFolderError("名称无效，不能包含文件路径字符");
  }
  const remoteStorage = isRemoteMediaStorage();
  const remoteNode = remoteStorage
    ? resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind)
    : null;
  if (folder === null || (!remoteStorage && !mediaFolderExists(asset.kind, folder))) {
    throw new MediaFolderError("目标文件夹不存在");
  }
  const categoryId = asset.kind === "video" && categoryValue !== undefined ? resolveVideoCategoryId(categoryValue) : asset.categoryId;

  const nextFileName = `${title}${extension}`;
  const nextStoredName = mediaStoredName(asset.kind, folder, nextFileName);
  const sourcePath = remoteStorage ? "" : mediaFilePath(asset.storedName);
  const targetPath = remoteStorage ? "" : mediaFilePath(nextStoredName);
  const samePathIgnoringCase = !remoteStorage && sourcePath.toLowerCase() === targetPath.toLowerCase();
  if (!remoteStorage && nextStoredName !== asset.storedName && fs.existsSync(targetPath) && !samePathIgnoringCase) {
    throw new MediaFolderError("目标文件夹存在同名文件");
  }

  let moved = false;
  if (nextStoredName !== asset.storedName) {
    if (remoteStorage) {
      try {
        await moveRemoteMediaAsset(remoteNode!.id, asset.storedName, nextStoredName);
      } catch (error) {
        remoteMediaError(error);
      }
    } else if (samePathIgnoringCase) {
      const temporaryPath = `${sourcePath}.${crypto.randomBytes(6).toString("hex")}.rename`;
      fs.renameSync(sourcePath, temporaryPath);
      try {
        fs.renameSync(temporaryPath, targetPath);
      } catch (error) {
        fs.renameSync(temporaryPath, sourcePath);
        throw error;
      }
    } else {
      fs.renameSync(sourcePath, targetPath);
    }
    moved = true;
  }

  const db = getDb();
  db.exec("BEGIN");
  try {
    const result = db
      .prepare(
        `UPDATE media_assets
         SET title = ?, artist = CASE WHEN kind = 'audio' THEN ? ELSE '' END, description = ?,
             file_name = ?, stored_name = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .run(title, artist, description, nextFileName, nextStoredName, id);
    if (asset.kind === "video" && categoryValue !== undefined) {
      db.prepare("UPDATE media_assets SET category_id = ? WHERE id = ?").run(categoryId, id);
    }
    db.prepare("UPDATE user_media_history SET title = ? WHERE media_id = ?").run(title, id);
    db.exec("COMMIT");
    markMediaLibraryDirty();
    return Number(result.changes) > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    if (moved) {
      if (remoteStorage) {
        await moveRemoteMediaAsset(remoteNode!.id, nextStoredName, asset.storedName).catch(() => undefined);
      } else {
        fs.renameSync(targetPath, sourcePath);
      }
    }
    throw error;
  }
}

export function incrementMediaPlayCount(id: number): boolean {
  return getDb().prepare("UPDATE media_assets SET play_count = play_count + 1 WHERE id = ?").run(id).changes > 0;
}

export function incrementMediaDownloadCount(id: number): boolean {
  return getDb().prepare("UPDATE media_assets SET download_count = download_count + 1 WHERE id = ?").run(id).changes > 0;
}

function normalizedMediaDate(value: string | null | undefined, fallback: string): string {
  const parsed = value ? new Date(value) : new Date(fallback);
  if (!Number.isFinite(parsed.getTime())) {
    throw new MediaFolderError("视频时间无效");
  }
  return parsed.toISOString().replace("T", " ").replace("Z", "");
}

export function updateVideoPublishingSettings(input: {
  id: number;
  playSodaPrice: number;
  downloadSodaPrice: number;
  publishedAt: string;
  newUntil?: string | null;
}): MediaAsset | null {
  const asset = getMediaAsset(input.id);
  if (!asset || asset.kind !== "video") return null;
  const playSodaPrice = Math.min(Math.max(Math.floor(Number(input.playSodaPrice) || 0), 0), 1_000_000);
  const downloadSodaPrice = Math.min(Math.max(Math.floor(Number(input.downloadSodaPrice) || 0), 0), 1_000_000);
  const publishedAt = normalizedMediaDate(input.publishedAt, asset.publishedAt);
  const newUntil = input.newUntil ? normalizedMediaDate(input.newUntil, input.newUntil) : null;
  getDb().prepare(
    `UPDATE media_assets
     SET play_soda_price = ?, download_soda_price = ?, published_at = ?, new_until = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND kind = 'video'`,
  ).run(playSodaPrice, downloadSodaPrice, publishedAt, newUntil, input.id);
  return getMediaAsset(input.id);
}

export function requestMediaPlaybackPreparation(
  asset: Pick<MediaAsset, "id" | "kind" | "mtimeMs" | "sizeBytes" | "playbackStatus" | "playbackVersion">,
  force = false,
): boolean {
  if (asset.kind !== "video") return false;
  const sourceVersion = `${Math.max(0, Math.floor(asset.mtimeMs))}-${Math.max(0, Math.floor(asset.sizeBytes))}`;
  const current = getMediaAsset(asset.id);
  if (
    !force &&
    current?.playbackFormat === "hls" &&
    current.playbackVersion === sourceVersion &&
    current.playbackManifestPath
  ) {
    return false;
  }
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO media_playback_jobs (media_id, source_version, status, attempts, last_error)
     VALUES (?, ?, 'pending', 0, '')
     ON CONFLICT(media_id) DO UPDATE SET
       source_version = excluded.source_version,
       status = 'pending',
       attempts = CASE
         WHEN media_playback_jobs.source_version = excluded.source_version THEN media_playback_jobs.attempts
         ELSE 0
       END,
       last_error = '',
       updated_at = CURRENT_TIMESTAMP
     WHERE media_playback_jobs.status <> 'processing'
        OR media_playback_jobs.source_version <> excluded.source_version`,
  ).run(asset.id, sourceVersion);
  if (Number(result.changes) > 0) {
    db.prepare(
      "UPDATE media_assets SET playback_status = 'pending', playback_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(asset.id);
    return true;
  }
  return false;
}

export function markMediaPlaybackProcessing(id: number, sourceVersion: string): boolean {
  const db = getDb();
  const claimed = db.prepare(
    `UPDATE media_playback_jobs
     SET status = 'processing', attempts = attempts + 1, last_error = '', updated_at = CURRENT_TIMESTAMP
     WHERE media_id = ? AND source_version = ? AND status = 'pending'`,
  ).run(id, sourceVersion).changes > 0;
  if (claimed) {
    db.prepare(
      "UPDATE media_assets SET playback_status = 'processing', playback_error = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    ).run(id);
  }
  return claimed;
}

export function refreshMediaPlaybackProcessing(id: number, sourceVersion: string): boolean {
  const db = getDb();
  const refreshed = db.prepare(
    `UPDATE media_playback_jobs
     SET updated_at = CURRENT_TIMESTAMP
     WHERE media_id = ? AND source_version = ? AND status = 'processing'`,
  ).run(id, sourceVersion).changes > 0;
  if (refreshed) {
    db.prepare("UPDATE media_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  }
  return refreshed;
}

export function recoverStaleMediaPlaybackPreparations(staleBefore: string): number {
  const db = getDb();
  const result = db.prepare(
    `UPDATE media_playback_jobs
     SET status = 'pending', last_error = '', updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND updated_at < ?`,
  ).run(staleBefore);
  if (Number(result.changes) > 0) {
    db.prepare(
      `UPDATE media_assets
       SET playback_status = 'pending', playback_error = '', updated_at = CURRENT_TIMESTAMP
       WHERE id IN (SELECT media_id FROM media_playback_jobs WHERE status = 'pending')`,
    ).run();
  }
  return Number(result.changes);
}

export function saveMediaPlaybackReady(input: {
  id: number;
  sourceVersion: string;
  manifestPath: string;
}): boolean {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const published = db.prepare(
      `UPDATE media_assets
       SET playback_format = 'hls', playback_version = ?, playback_manifest_path = ?,
           playback_status = 'ready', playback_error = '', playback_published_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND kind = 'video'
         AND CAST(mtime_ms AS INTEGER) || '-' || CAST(size_bytes AS INTEGER) = ?
         AND EXISTS (
           SELECT 1 FROM media_playback_jobs
           WHERE media_id = ? AND source_version = ? AND status = 'processing'
         )`,
    ).run(
      input.sourceVersion,
      input.manifestPath,
      input.id,
      input.sourceVersion,
      input.id,
      input.sourceVersion,
    ).changes > 0;
    const removedJob = published && db.prepare(
      "DELETE FROM media_playback_jobs WHERE media_id = ? AND source_version = ? AND status = 'processing'",
    ).run(input.id, input.sourceVersion).changes > 0;
    if (!published || !removedJob) {
      db.exec("ROLLBACK");
      return false;
    }
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function saveMediaPlaybackFailure(id: number, sourceVersion: string, error: unknown): boolean {
  const message = (error instanceof Error ? error.message : "HLS 播放准备失败")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
  const db = getDb();
  const failed = db.prepare(
    `UPDATE media_playback_jobs
     SET status = 'failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
     WHERE media_id = ? AND source_version = ? AND status = 'processing'`,
  ).run(message, id, sourceVersion).changes > 0;
  if (failed) {
    db.prepare(
      `UPDATE media_assets
       SET playback_status = CASE
             WHEN playback_format = 'hls' AND playback_manifest_path IS NOT NULL AND playback_version <> ''
               THEN 'ready'
             ELSE 'failed'
           END,
           playback_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(message, id);
  }
  return failed;
}

export async function deleteMediaAssets(ids: number[]): Promise<{ deleted: number; fileDeleteFailures: number }> {
  const uniqueIds = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) {
    return { deleted: 0, fileDeleteFailures: 0 };
  }
  const placeholders = uniqueIds.map(() => "?").join(", ");
  const rows = getDb().prepare(`SELECT id, kind, storage_node_id, stored_name, custom_cover_key FROM media_assets WHERE id IN (${placeholders})`).all(...uniqueIds) as Array<{
    id: number;
    kind: MediaKind;
    storage_node_id: string | null;
    stored_name: string;
    custom_cover_key: string | null;
  }>;
  const deletedIds: number[] = [];
  let fileDeleteFailures = 0;
  if (isRemoteMediaStorage()) {
    const rowsByNode = new Map<string, typeof rows>();
    for (const row of rows) {
      const nodeId = resolveRemoteMediaNodeForAsset(row.storage_node_id, row.kind).id;
      rowsByNode.set(nodeId, [...(rowsByNode.get(nodeId) || []), row]);
    }
    for (const [nodeId, nodeRows] of rowsByNode) {
      try {
        const result = await deleteRemoteMediaAssets(
          nodeId,
          nodeRows.map((row) => row.stored_name),
          Object.fromEntries(nodeRows.map((row) => [row.stored_name, row.kind === "video" ? row.id : 0])),
        );
        const deletedNames = new Set(result.deletedStoredNames);
        for (const row of nodeRows) {
          if (deletedNames.has(row.stored_name)) {
            deletedIds.push(row.id);
          } else {
            fileDeleteFailures += 1;
          }
        }
      } catch (error) {
        fileDeleteFailures += nodeRows.length;
        console.warn(`[media] failed to delete assets from node ${nodeId}`, error);
      }
    }
  } else {
    for (const row of rows) {
      try {
        fs.rmSync(mediaFilePath(row.stored_name), { force: true });
        removeThumbnailFile(row.id);
        if (row.kind === "video") {
          removePlaybackHlsVersions(getMediaDir(), row.id);
        }
        deletedIds.push(row.id);
      } catch {
        fileDeleteFailures += 1;
      }
    }
  }
  if (!deletedIds.length) {
    return { deleted: 0, fileDeleteFailures };
  }
  const deletedIdSet = new Set(deletedIds);
  for (const row of rows) {
    if (!deletedIdSet.has(row.id) || !row.custom_cover_key) continue;
    await deleteMediaCustomCover(
      { kind: row.kind, storageNodeId: row.storage_node_id },
      row.custom_cover_key,
    ).catch((error) => {
      console.warn(`[media] failed to delete custom cover for asset ${row.id}`, error);
    });
  }
  const rowPlaceholders = deletedIds.map(() => "?").join(", ");
  const deleted = Number(getDb().prepare(`DELETE FROM media_assets WHERE id IN (${rowPlaceholders})`).run(...deletedIds).changes);
  markMediaLibraryDirty();
  return { deleted, fileDeleteFailures };
}

export type ByteRange = { start: number; end: number };

export function parseMediaByteRange(value: string | null, size: number): ByteRange | null | "invalid" {
  if (!value) {
    return null;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) {
    return "invalid";
  }
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return "invalid";
    }
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= size || requestedEnd < start) {
    return "invalid";
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
