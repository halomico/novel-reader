import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { database, withTransaction, type SqlExecutor } from "@/core/db/postgres";
import { getMediaDir } from "@/lib/config";
import { deleteMediaCustomCover } from "@/lib/media-cover";
import {
  createRemoteMediaFolder,
  deleteRemoteMediaAssets,
  deleteRemoteMediaFolder,
  MediaNodeClientError,
  moveRemoteMediaAsset,
  renameRemoteMediaFolder,
} from "@/lib/media-node-client";
import {
  getRemoteMediaNodeForKind,
  isRemoteMediaStorage,
  resolveRemoteMediaNodeForAsset,
} from "@/lib/media-storage-config";
import { removePlaybackHlsVersions } from "@/lib/video-hls";
import {
  normalizeMediaFolder,
  type MediaAsset,
  type MediaKind,
} from "./media-model";
import {
  ensureLocalMediaDirectories,
  localMediaFolderExists,
  mediaFolderAbsolutePath,
  mediaFilePath,
  mediaStoredName,
  MediaFolderError,
  normalizeMediaFolderName,
  normalizeMediaTitle,
} from "./media-storage-model";
import { getPostgresMediaAsset, postgresMediaRowToAsset } from "./postgres-media-catalog";

export { MediaFolderError } from "./media-storage-model";

export class MediaCategoryError extends Error {}
export class MediaTagError extends Error {}

type TransactionRunner = <T>(operation: (transaction: SqlExecutor) => Promise<T>) => Promise<T>;

type MediaAssetCreate = {
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
};

type DeletedMediaRow = QueryResultRow & {
  id: string | number;
  kind: MediaKind;
  storage_node_id: string | null;
  stored_name: string;
  custom_cover_key: string | null;
};

function uniquePositiveIntegers(values: readonly number[], maximum = 1_000): number[] {
  return [...new Set(values.filter((id) => Number.isSafeInteger(id) && id > 0))].slice(0, maximum);
}

function positiveInteger(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`Invalid ${label}`);
  return number;
}

function normalizedSortOrder(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.floor(number), -9_999), 9_999) : 0;
}

function categoryName(value: unknown): string | null {
  const name = typeof value === "string" ? value.normalize("NFKC").trim().replace(/\s+/gu, " ") : "";
  return name && name.length <= 24 && !/[\u0000-\u001f\u007f]/u.test(name) ? name : null;
}

function tagName(value: unknown): string | null {
  const name = String(value || "").normalize("NFKC").trim();
  return name && Array.from(name).length <= 40 && /^[\p{L}\p{N}]+$/u.test(name) ? name : null;
}

function tagDescription(value: unknown): string | null {
  const description = String(value || "").normalize("NFKC").trim();
  return description.length <= 500 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(description)
    ? description
    : null;
}

function tagSlugBase(name: string): string {
  return name
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\s+/gu, "-")
    .replace(/[^\p{L}\p{N}_-]+/gu, "")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64) || "tag";
}

function isPostgresUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function escapedLike(value: string): string {
  return value.replace(/[\\%_]/gu, "\\$&");
}

export async function resolvePostgresVideoCategoryId(executor: SqlExecutor, value: unknown): Promise<number | null> {
  if (value === null || value === undefined || value === "") return null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new MediaCategoryError("视频分类无效");
  const result = await executor.query({ text: "SELECT 1 FROM video_categories WHERE id = $1", values: [id] });
  if (!result.rowCount) throw new MediaCategoryError("视频分类不存在");
  return id;
}

export async function createPostgresVideoCategory(
  nameValue: unknown,
  sortOrder?: number,
  visible = true,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  const name = categoryName(nameValue);
  if (!name) throw new MediaCategoryError("分类名称应为 1 到 24 个字符");
  try {
    return await transaction(async (tx) => {
      await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended('video-categories-order-v1', 0))" });
      const result = await tx.query<QueryResultRow & { id: string | number }>({
        text: `INSERT INTO video_categories (name, sort_order, is_visible)
          VALUES ($1, COALESCE($2::integer, (SELECT COALESCE(MAX(sort_order), -10) + 10 FROM video_categories)), $3)
          RETURNING id`,
        values: [name, sortOrder === undefined ? null : normalizedSortOrder(sortOrder), visible],
      });
      return positiveInteger(result.rows[0]?.id, "video category id");
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) throw new MediaCategoryError("同名视频分类已存在");
    throw error;
  }
}

export async function updatePostgresVideoCategory(
  executor: SqlExecutor,
  idValue: number,
  nameValue: unknown,
  sortOrder: number,
  visible: boolean,
): Promise<boolean> {
  if (!Number.isSafeInteger(idValue) || idValue < 1) return false;
  const name = categoryName(nameValue);
  if (!name) throw new MediaCategoryError("分类名称应为 1 到 24 个字符");
  try {
    const result = await executor.query({
      text: `UPDATE video_categories SET name = $2, sort_order = $3, is_visible = $4,
        updated_at = clock_timestamp() WHERE id = $1`,
      values: [idValue, name, normalizedSortOrder(sortOrder), visible],
    });
    return result.rowCount === 1;
  } catch (error) {
    if (isPostgresUniqueViolation(error)) throw new MediaCategoryError("同名视频分类已存在");
    throw error;
  }
}

export async function deletePostgresVideoCategory(executor: SqlExecutor, idValue: number): Promise<boolean> {
  if (!Number.isSafeInteger(idValue) || idValue < 1) return false;
  const result = await executor.query({ text: "DELETE FROM video_categories WHERE id = $1", values: [idValue] });
  return result.rowCount === 1;
}

export async function setPostgresVideoCategoryForAssets(
  executor: SqlExecutor,
  values: readonly number[],
  categoryValue: unknown,
): Promise<number> {
  const ids = uniquePositiveIntegers(values);
  if (!ids.length) return 0;
  const categoryId = await resolvePostgresVideoCategoryId(executor, categoryValue);
  const result = await executor.query({
    text: `UPDATE media_assets SET category_id = $2, updated_at = clock_timestamp()
      WHERE kind = 'video' AND id = ANY($1::bigint[])`,
    values: [ids, categoryId],
  });
  return result.rowCount ?? 0;
}

export async function createPostgresVideoTag(
  nameValue: unknown,
  descriptionValue: unknown = "",
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  const name = tagName(nameValue);
  const description = tagDescription(descriptionValue);
  if (!name || description === null) {
    throw new MediaTagError("标签名称只能包含中英文和数字，最多 40 个字符；描述不能超过 500 个字符");
  }
  try {
    return await transaction(async (tx) => {
      await tx.query({ text: "SELECT pg_advisory_xact_lock(hashtextextended('video-tags-create-v1', 0))" });
      const duplicate = await tx.query({ text: "SELECT 1 FROM video_tags WHERE lower(name) = lower($1)", values: [name] });
      if (duplicate.rowCount) throw new MediaTagError("同名视频标签已存在");
      const base = tagSlugBase(name);
      let slug = base;
      for (let suffix = 2; suffix < 10_000; suffix += 1) {
        const found = await tx.query({ text: "SELECT 1 FROM video_tags WHERE lower(slug) = lower($1)", values: [slug] });
        if (!found.rowCount) break;
        slug = `${base.slice(0, Math.max(1, 64 - String(suffix).length - 1))}-${suffix}`;
      }
      const result = await tx.query<QueryResultRow & { id: string | number }>({
        text: `INSERT INTO video_tags (name, slug, description, sort_order)
          VALUES ($1, $2, $3, (SELECT COALESCE(MAX(sort_order), -10) + 10 FROM video_tags)) RETURNING id`,
        values: [name, slug, description],
      });
      return positiveInteger(result.rows[0]?.id, "video tag id");
    });
  } catch (error) {
    if (error instanceof MediaTagError) throw error;
    if (isPostgresUniqueViolation(error)) throw new MediaTagError("同名视频标签已存在");
    throw error;
  }
}

export async function updatePostgresVideoTag(
  executor: SqlExecutor,
  idValue: number,
  nameValue: unknown,
  descriptionValue: unknown,
  sortOrder: number,
  visible: boolean,
): Promise<boolean> {
  if (!Number.isSafeInteger(idValue) || idValue < 1) return false;
  const name = tagName(nameValue);
  const description = tagDescription(descriptionValue);
  if (!name || description === null) {
    throw new MediaTagError("标签名称只能包含中英文和数字，最多 40 个字符；描述不能超过 500 个字符");
  }
  try {
    const result = await executor.query({
      text: `UPDATE video_tags SET name = $2, description = $3, sort_order = $4, is_visible = $5,
        updated_at = clock_timestamp() WHERE id = $1`,
      values: [idValue, name, description, normalizedSortOrder(sortOrder), visible],
    });
    return result.rowCount === 1;
  } catch (error) {
    if (isPostgresUniqueViolation(error)) throw new MediaTagError("同名视频标签已存在");
    throw error;
  }
}

export async function deletePostgresVideoTag(executor: SqlExecutor, idValue: number): Promise<boolean> {
  if (!Number.isSafeInteger(idValue) || idValue < 1) return false;
  const result = await executor.query({ text: "DELETE FROM video_tags WHERE id = $1", values: [idValue] });
  return result.rowCount === 1;
}

export async function setPostgresVideoTagsForAssets(
  values: readonly number[],
  tagValues: readonly number[],
  transaction: TransactionRunner = (operation) => withTransaction(operation),
): Promise<number> {
  const ids = uniquePositiveIntegers(values);
  const tagIds = uniquePositiveIntegers(tagValues, 200);
  if (!ids.length) return 0;
  return transaction(async (tx) => {
    const videos = await tx.query<QueryResultRow & { id: string | number }>({
      text: "SELECT id FROM media_assets WHERE kind = 'video' AND id = ANY($1::bigint[]) FOR UPDATE",
      values: [ids],
    });
    if (tagIds.length) {
      const found = await tx.query({ text: "SELECT id FROM video_tags WHERE id = ANY($1::bigint[])", values: [tagIds] });
      if (found.rowCount !== tagIds.length) throw new MediaTagError("所选视频标签不存在");
    }
    const videoIds = videos.rows.map((row) => positiveInteger(row.id, "media id"));
    if (!videoIds.length) return 0;
    await tx.query({ text: "DELETE FROM media_asset_tags WHERE media_id = ANY($1::bigint[])", values: [videoIds] });
    if (tagIds.length) {
      await tx.query({
        text: `INSERT INTO media_asset_tags (media_id, tag_id)
          SELECT media_id, tag_id FROM unnest($1::bigint[]) media_id CROSS JOIN unnest($2::bigint[]) tag_id`,
        values: [videoIds, tagIds],
      });
    }
    await tx.query({
      text: "UPDATE media_assets SET updated_at = clock_timestamp() WHERE id = ANY($1::bigint[])",
      values: [videoIds],
    });
    return videoIds.length;
  });
}

export async function createPostgresMediaAsset(executor: SqlExecutor, params: MediaAssetCreate): Promise<MediaAsset> {
  const categoryId = params.kind === "video"
    ? await resolvePostgresVideoCategoryId(executor, params.categoryId)
    : null;
  const sizeBytes = Number(params.sizeBytes);
  const mtimeMs = Number(params.mtimeMs || 0);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || !Number.isSafeInteger(mtimeMs) || mtimeMs < 0) {
    throw new MediaFolderError("媒体文件大小或时间无效");
  }
  const duration = Number(params.durationSeconds);
  try {
    const result = await executor.query<Parameters<typeof postgresMediaRowToAsset>[0]>({
      text: `INSERT INTO media_assets (
          kind, storage_node_id, category_id, title, artist, description, file_name, stored_name,
          mime_type, size_bytes, mtime_ms, duration_seconds
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      values: [
        params.kind,
        params.storageNodeId || null,
        categoryId,
        params.title,
        params.kind === "file" ? "" : params.artist || "",
        params.description || "",
        params.fileName,
        params.storedName,
        params.mimeType,
        sizeBytes,
        mtimeMs,
        Number.isFinite(duration) && duration > 0 ? duration : null,
      ],
    });
    const row = result.rows[0];
    if (!row) throw new Error("PostgreSQL did not return the created media asset");
    return postgresMediaRowToAsset(row);
  } catch (error) {
    if (isPostgresUniqueViolation(error)) throw new MediaFolderError("同名资源已存在");
    throw error;
  }
}

export async function indexedPostgresMediaStoredNames(
  executor: SqlExecutor,
  kind: MediaKind,
  folderValue: string,
  fileName: string,
): Promise<Set<string>> {
  const folder = normalizeMediaFolder(folderValue);
  if (folder === null) throw new MediaFolderError("资源路径无效");
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const exact = mediaStoredName(kind, folder, fileName);
  const prefix = [kind, folder].filter(Boolean).join("/");
  const relatedPattern = `${escapedLike(`${prefix}/${baseName}`)} (%)${escapedLike(extension)}`;
  const result = await executor.query<QueryResultRow & { stored_name: string }>({
    text: "SELECT stored_name FROM media_assets WHERE stored_name = $1 OR stored_name LIKE $2 ESCAPE '\\' LIMIT 10000",
    values: [exact, relatedPattern],
  });
  return new Set(result.rows.map((row) => row.stored_name));
}

function mediaStorageNodeKey(kind: MediaKind): string {
  return isRemoteMediaStorage() ? getRemoteMediaNodeForKind(kind).id : "";
}

async function registerPostgresMediaFolderTree(
  executor: SqlExecutor,
  kind: MediaKind,
  storageNodeId: string,
  folderValue: string,
  mtimeMs = Date.now(),
): Promise<void> {
  const folder = normalizeMediaFolder(folderValue);
  if (!folder) return;
  const segments = folder.split("/");
  const paths = segments.map((_, index) => segments.slice(0, index + 1).join("/"));
  await executor.query({
    text: `INSERT INTO media_folders (kind, storage_node_id, path, mtime_ms)
      SELECT $1, $2, path, $4 FROM unnest($3::text[]) path
      ON CONFLICT (kind, storage_node_id, path) DO UPDATE
      SET mtime_ms = GREATEST(media_folders.mtime_ms, EXCLUDED.mtime_ms), updated_at = clock_timestamp()`,
    values: [kind, storageNodeId, paths, Math.max(Math.floor(mtimeMs), 0)],
  });
}

export async function createPostgresMediaFolder(
  kind: MediaKind,
  parentValue: string,
  nameValue: unknown,
  executor: SqlExecutor = database(),
): Promise<string> {
  const parent = normalizeMediaFolder(parentValue);
  const name = normalizeMediaFolderName(nameValue);
  if (parent === null || !name) throw new MediaFolderError("文件夹名称无效");
  const requestedFolder = [parent, name].filter(Boolean).join("/");
  const storageNodeId = mediaStorageNodeKey(kind);
  let folder = requestedFolder;
  let created = false;
  try {
    if (isRemoteMediaStorage()) {
      folder = await createRemoteMediaFolder(storageNodeId, kind, requestedFolder);
    } else {
      ensureLocalMediaDirectories();
      const parentPath = mediaFolderAbsolutePath(kind, parent || "");
      if (!(await fs.promises.stat(parentPath)).isDirectory()) throw new MediaFolderError("上级文件夹不存在");
      const targetPath = mediaFolderAbsolutePath(kind, requestedFolder);
      try {
        await fs.promises.mkdir(targetPath);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
          throw new MediaFolderError("文件夹已存在");
        }
        throw error;
      }
    }
    created = true;
    await registerPostgresMediaFolderTree(executor, kind, storageNodeId, folder);
    return folder;
  } catch (error) {
    if (created) {
      if (isRemoteMediaStorage()) {
        await deleteRemoteMediaFolder(storageNodeId, kind, folder).catch(() => undefined);
      } else {
        await fs.promises.rmdir(mediaFolderAbsolutePath(kind, folder)).catch(() => undefined);
      }
    }
    remoteFolderError(error);
  }
}

export async function renamePostgresMediaFolder(
  kind: MediaKind,
  folderValue: string,
  nameValue: unknown,
): Promise<string> {
  const folder = normalizeMediaFolder(folderValue);
  const name = normalizeMediaFolderName(nameValue);
  if (!folder || !name) throw new MediaFolderError("文件夹名称无效");
  const segments = folder.split("/");
  const parent = segments.slice(0, -1).join("/");
  const nextFolder = [parent, name].filter(Boolean).join("/");
  if (nextFolder === folder) return folder;
  const remote = isRemoteMediaStorage();
  const storageNodeId = mediaStorageNodeKey(kind);
  const sourcePath = remote ? "" : mediaFolderAbsolutePath(kind, folder);
  const targetPath = remote ? "" : mediaFolderAbsolutePath(kind, nextFolder);
  const executor = database();
  const registryCollision = await executor.query({
    text: "SELECT 1 FROM media_folders WHERE kind = $1 AND storage_node_id = $2 AND path = $3",
    values: [kind, storageNodeId, nextFolder],
  });
  if (registryCollision.rowCount) throw new MediaFolderError("同名文件夹已存在");
  try {
    if (remote) {
      await renameRemoteMediaFolder(storageNodeId, kind, folder, nextFolder);
    } else {
      if (!fs.existsSync(sourcePath)) throw new MediaFolderError("文件夹不存在");
      if (fs.existsSync(targetPath)) throw new MediaFolderError("同名文件夹已存在");
      await fs.promises.rename(sourcePath, targetPath);
    }
  } catch (error) {
    remoteFolderError(error);
  }

  const oldPrefix = `${kind}/${folder}/`;
  const nextPrefix = `${kind}/${nextFolder}/`;
  const includeUnassigned = remote && resolveRemoteMediaNodeForAsset(null, kind).id === storageNodeId;
  try {
    await withTransaction(async (tx) => {
      await tx.query({
        text: `UPDATE media_assets
          SET stored_name = $5 || substr(stored_name, length($3) + 1), updated_at = clock_timestamp()
          WHERE kind = $1 AND stored_name LIKE $4 ESCAPE '\\'
            AND ($2 = '' AND storage_node_id IS NULL OR $2 <> '' AND (storage_node_id = $2 OR $6 AND storage_node_id IS NULL))`,
        values: [kind, storageNodeId, oldPrefix, `${escapedLike(oldPrefix)}%`, nextPrefix, includeUnassigned],
      });
      const updated = await tx.query({
        text: `UPDATE media_folders
          SET path = $4 || substr(path, length($3) + 1), updated_at = clock_timestamp()
          WHERE kind = $1 AND storage_node_id = $2 AND (path = $3 OR left(path, length($3) + 1) = $3 || '/')`,
        values: [kind, storageNodeId, folder, nextFolder],
      });
      if (!updated.rowCount) {
        await registerPostgresMediaFolderTree(tx, kind, storageNodeId, nextFolder);
      }
    });
    return nextFolder;
  } catch (error) {
    if (remote) {
      await renameRemoteMediaFolder(storageNodeId, kind, nextFolder, folder).catch(() => undefined);
    } else {
      await fs.promises.rename(targetPath, sourcePath).catch(() => undefined);
    }
    if (isPostgresUniqueViolation(error)) throw new MediaFolderError("同名文件夹已存在");
    throw error;
  }
}

export async function deletePostgresMediaFolder(
  kind: MediaKind,
  folderValue: string,
  executor: SqlExecutor = database(),
): Promise<boolean> {
  const folder = normalizeMediaFolder(folderValue);
  if (!folder) throw new MediaFolderError("不能删除分类根目录");
  const storageNodeId = mediaStorageNodeKey(kind);
  let deleted = false;
  try {
    if (isRemoteMediaStorage()) {
      deleted = await deleteRemoteMediaFolder(storageNodeId, kind, folder);
    } else {
      const targetPath = mediaFolderAbsolutePath(kind, folder);
      if (!fs.existsSync(targetPath)) {
        await executor.query({
          text: "DELETE FROM media_folders WHERE kind = $1 AND storage_node_id = $2 AND path = $3",
          values: [kind, storageNodeId, folder],
        });
        return false;
      }
      if ((await fs.promises.readdir(targetPath)).length) throw new MediaFolderError("只能删除空文件夹");
      await fs.promises.rmdir(targetPath);
      deleted = true;
    }
  } catch (error) {
    remoteFolderError(error);
  }
  if (deleted) {
    try {
      await executor.query({
        text: `DELETE FROM media_folders WHERE kind = $1 AND storage_node_id = $2
          AND (path = $3 OR left(path, length($3) + 1) = $3 || '/')`,
        values: [kind, storageNodeId, folder],
      });
    } catch (error) {
      if (isRemoteMediaStorage()) {
        await createRemoteMediaFolder(storageNodeId, kind, folder).catch(() => undefined);
      } else {
        await fs.promises.mkdir(mediaFolderAbsolutePath(kind, folder), { recursive: true }).catch(() => undefined);
      }
      await registerPostgresMediaFolderTree(executor, kind, storageNodeId, folder).catch(() => undefined);
      throw error;
    }
  }
  return deleted;
}

function normalizedDate(value: string | null | undefined, fallback: string): string {
  const parsed = new Date(value || fallback);
  if (!Number.isFinite(parsed.getTime())) throw new MediaFolderError("视频时间无效");
  return parsed.toISOString();
}

export async function updatePostgresVideoPublishingSettings(
  executor: SqlExecutor,
  input: { id: number; playSodaPrice: number; downloadSodaPrice: number; publishedAt: string; newUntil?: string | null },
): Promise<MediaAsset | null> {
  const id = positiveInteger(input.id, "media id");
  const current = await getPostgresMediaAsset(executor, id);
  if (!current || current.kind !== "video") return null;
  const playSodaPrice = Math.min(Math.max(Math.floor(Number(input.playSodaPrice) || 0), 0), 1_000_000);
  const downloadSodaPrice = Math.min(Math.max(Math.floor(Number(input.downloadSodaPrice) || 0), 0), 1_000_000);
  await executor.query({
    text: `UPDATE media_assets SET play_soda_price = $2, download_soda_price = $3, published_at = $4,
      new_until = $5, updated_at = clock_timestamp() WHERE id = $1 AND kind = 'video'`,
    values: [
      id,
      playSodaPrice,
      downloadSodaPrice,
      normalizedDate(input.publishedAt, current.publishedAt),
      input.newUntil ? normalizedDate(input.newUntil, input.newUntil) : null,
    ],
  });
  return getPostgresMediaAsset(executor, id);
}

export async function savePostgresMediaDuration(
  executor: SqlExecutor,
  idValue: number,
  durationValue: number,
): Promise<boolean> {
  const id = positiveInteger(idValue, "media id");
  const duration = Number(durationValue);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const result = await executor.query({
    text: `UPDATE media_assets SET duration_seconds = $2, updated_at = clock_timestamp()
      WHERE id = $1 AND kind IN ('video', 'audio')`,
    values: [id, duration],
  });
  return result.rowCount === 1;
}

export async function savePostgresMediaThumbnailVersion(
  executor: SqlExecutor,
  idValue: number,
  sourceVersion: number,
): Promise<boolean> {
  const id = positiveInteger(idValue, "media id");
  const version = Number(sourceVersion);
  if (!Number.isSafeInteger(version) || version < 0) return false;
  const result = await executor.query({
    text: `UPDATE media_assets SET thumbnail_version = $2, updated_at = clock_timestamp()
      WHERE id = $1 AND kind = 'video'`,
    values: [id, version],
  });
  return result.rowCount === 1;
}

function remoteFolderError(error: unknown): never {
  if (error instanceof MediaNodeClientError) throw new MediaFolderError(error.message);
  throw error;
}

async function moveLocalMediaFile(sourcePath: string, targetPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  if (sourcePath.toLowerCase() === targetPath.toLowerCase() && sourcePath !== targetPath) {
    const temporaryPath = `${sourcePath}.${crypto.randomBytes(6).toString("hex")}.rename`;
    await fs.promises.rename(sourcePath, temporaryPath);
    try {
      await fs.promises.rename(temporaryPath, targetPath);
    } catch (error) {
      await fs.promises.rename(temporaryPath, sourcePath).catch(() => undefined);
      throw error;
    }
    return;
  }
  await fs.promises.rename(sourcePath, targetPath);
}

export async function updatePostgresMediaAsset(input: {
  id: number;
  title: string;
  artist: string;
  description: string;
  folder?: string;
  categoryValue?: unknown;
}): Promise<MediaAsset | null> {
  const executor = database();
  const id = positiveInteger(input.id, "media id");
  const asset = await getPostgresMediaAsset(executor, id);
  if (!asset) return null;
  const extension = path.extname(asset.fileName);
  const title = normalizeMediaTitle(input.title, extension);
  const folder = normalizeMediaFolder(input.folder ?? asset.folder);
  if (!title) throw new MediaFolderError("名称无效，不能包含文件路径字符");
  if (folder === null) throw new MediaFolderError("目标文件夹不存在");
  const remoteStorage = isRemoteMediaStorage();
  if (!remoteStorage && !localMediaFolderExists(asset.kind, folder)) {
    throw new MediaFolderError("目标文件夹不存在");
  }
  const categoryId = asset.kind === "video" && input.categoryValue !== undefined
    ? await resolvePostgresVideoCategoryId(executor, input.categoryValue)
    : asset.categoryId;
  const nextFileName = `${title}${extension}`;
  const nextStoredName = mediaStoredName(asset.kind, folder, nextFileName);
  const sourcePath = remoteStorage ? "" : mediaFilePath(asset.storedName);
  const targetPath = remoteStorage ? "" : mediaFilePath(nextStoredName);
  if (
    !remoteStorage &&
    nextStoredName !== asset.storedName &&
    sourcePath.toLowerCase() !== targetPath.toLowerCase() &&
    fs.existsSync(targetPath)
  ) {
    throw new MediaFolderError("目标文件夹存在同名文件");
  }

  let moved = false;
  if (nextStoredName !== asset.storedName) {
    if (remoteStorage) {
      const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
      try {
        await moveRemoteMediaAsset(node.id, asset.storedName, nextStoredName);
      } catch (error) {
        remoteFolderError(error);
      }
    } else {
      await moveLocalMediaFile(sourcePath, targetPath);
    }
    moved = true;
  }

  try {
    const updated = await withTransaction(async (tx) => {
      const result = await tx.query({
        text: `UPDATE media_assets SET title = $3,
          artist = CASE WHEN kind IN ('audio', 'video') THEN $4 ELSE '' END,
          description = $5, file_name = $6, stored_name = $7, category_id = $8,
          updated_at = clock_timestamp()
          WHERE id = $1 AND stored_name = $2`,
        values: [id, asset.storedName, title, input.artist, input.description, nextFileName, nextStoredName, categoryId],
      });
      if (result.rowCount !== 1) throw new MediaFolderError("资源已被其他操作修改，请刷新后重试");
      await tx.query({
        text: "UPDATE user_media_history SET title = $2 WHERE media_id = $1",
        values: [id, title],
      });
      return getPostgresMediaAsset(tx, id);
    });
    return updated;
  } catch (error) {
    if (moved) {
      if (remoteStorage) {
        const node = resolveRemoteMediaNodeForAsset(asset.storageNodeId, asset.kind);
        await moveRemoteMediaAsset(node.id, nextStoredName, asset.storedName).catch(() => undefined);
      } else {
        await moveLocalMediaFile(targetPath, sourcePath).catch(() => undefined);
      }
    }
    if (isPostgresUniqueViolation(error)) throw new MediaFolderError("目标文件夹存在同名文件");
    throw error;
  }
}

function removeLocalDerivedFiles(id: number, kind: MediaKind): void {
  const thumbnailDirectory = path.join(getMediaDir(), ".thumbnails");
  if (fs.existsSync(thumbnailDirectory)) {
    for (const fileName of fs.readdirSync(thumbnailDirectory)) {
      if (fileName.startsWith(`${id}-`)) fs.rmSync(path.join(thumbnailDirectory, fileName), { force: true });
    }
  }
  if (kind === "video") removePlaybackHlsVersions(getMediaDir(), id);
}

export async function deletePostgresMediaAssets(
  values: readonly number[],
  executor: SqlExecutor = database(),
): Promise<{ deleted: number; fileDeleteFailures: number }> {
  const ids = uniquePositiveIntegers(values);
  if (!ids.length) return { deleted: 0, fileDeleteFailures: 0 };
  const selected = await executor.query<DeletedMediaRow>({
    text: "SELECT id, kind, storage_node_id, stored_name, custom_cover_key FROM media_assets WHERE id = ANY($1::bigint[])",
    values: [ids],
  });
  const rows = selected.rows;
  const deletedIds: number[] = [];
  let fileDeleteFailures = 0;

  if (isRemoteMediaStorage()) {
    const byNode = new Map<string, DeletedMediaRow[]>();
    for (const row of rows) {
      const nodeId = resolveRemoteMediaNodeForAsset(row.storage_node_id, row.kind).id;
      byNode.set(nodeId, [...(byNode.get(nodeId) || []), row]);
    }
    for (const [nodeId, nodeRows] of byNode) {
      try {
        const result = await deleteRemoteMediaAssets(
          nodeId,
          nodeRows.map((row) => row.stored_name),
          Object.fromEntries(nodeRows.map((row) => [row.stored_name, row.kind === "video" ? Number(row.id) : 0])),
        );
        const names = new Set(result.deletedStoredNames);
        for (const row of nodeRows) {
          if (names.has(row.stored_name)) deletedIds.push(positiveInteger(row.id, "media id"));
          else fileDeleteFailures += 1;
        }
      } catch (error) {
        fileDeleteFailures += nodeRows.length;
        console.warn(`[media] failed to delete assets from node ${nodeId}`, error);
      }
    }
  } else {
    const trashRoot = path.join(getMediaDir(), ".trash", crypto.randomBytes(12).toString("hex"));
    const staged = new Map<number, { source: string; trash: string }>();
    try {
      for (const row of rows) {
        const id = positiveInteger(row.id, "media id");
        const source = mediaFilePath(row.stored_name);
        const trash = path.join(trashRoot, String(id), path.basename(row.stored_name));
        try {
          await fs.promises.mkdir(path.dirname(trash), { recursive: true });
          await fs.promises.rename(source, trash);
          staged.set(id, { source, trash });
          deletedIds.push(id);
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
            deletedIds.push(id);
          } else {
            fileDeleteFailures += 1;
          }
        }
      }
      if (deletedIds.length) {
        const result = await executor.query({
          text: "DELETE FROM media_assets WHERE id = ANY($1::bigint[])",
          values: [deletedIds],
        });
        if (result.rowCount !== deletedIds.length) throw new Error("Media deletion changed concurrently");
      }
    } catch (error) {
      for (const { source, trash } of staged.values()) {
        await fs.promises.mkdir(path.dirname(source), { recursive: true }).catch(() => undefined);
        await fs.promises.rename(trash, source).catch(() => undefined);
      }
      throw error;
    }
    await fs.promises.rm(trashRoot, { recursive: true, force: true }).catch((error) => {
      console.warn("[media] failed to purge staged media trash", error);
    });
  }

  if (isRemoteMediaStorage() && deletedIds.length) {
    const result = await executor.query({
      text: "DELETE FROM media_assets WHERE id = ANY($1::bigint[])",
      values: [deletedIds],
    });
    if (result.rowCount !== deletedIds.length) throw new Error("Media deletion changed concurrently");
  }

  const deletedSet = new Set(deletedIds);
  for (const row of rows) {
    const id = positiveInteger(row.id, "media id");
    if (!deletedSet.has(id)) continue;
    if (!isRemoteMediaStorage()) removeLocalDerivedFiles(id, row.kind);
    if (row.custom_cover_key) {
      await deleteMediaCustomCover(
        { kind: row.kind, storageNodeId: row.storage_node_id },
        row.custom_cover_key,
      ).catch((error) => console.warn(`[media] failed to delete custom cover for asset ${id}`, error));
    }
  }
  return { deleted: deletedIds.length, fileDeleteFailures };
}
