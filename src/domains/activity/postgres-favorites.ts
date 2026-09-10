import type { QueryResultRow } from "pg";
import { withTransaction, type SqlExecutor } from "@/core/db/postgres";
import type { OriginalArticleRowItem } from "@/components/OriginalArticleRows";

export type PostgresFavoriteMediaKind = "video" | "audio";

export type PostgresFavoriteMedia = Readonly<{
  id: number;
  kind: PostgresFavoriteMediaKind;
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
}>;

export type PostgresFavoritePage<T> = Readonly<{
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}>;

type TransactionRunner = <T>(operation: (tx: SqlExecutor) => Promise<T>) => Promise<T>;
type FavoriteRow = QueryResultRow & { favorite: boolean };
type PageMeta = QueryResultRow & {
  total_items: string | number;
  total_pages: string | number;
  page: string | number;
};

type OriginalRow = PageMeta & {
  id: string | number | null;
  slug: string | null;
  author_id: string | number | null;
  author_name: string | null;
  author_avatar_path: string | null;
  title: string | null;
  word_count: string | number | null;
  unlock_soda_price: string | number | null;
  status: "draft" | "published" | "hidden" | null;
  is_pinned: boolean | null;
  comment_count: string | number | null;
  created_at: Date | string | null;
  published_at: Date | string | null;
  tags: unknown;
};

type MediaRow = PageMeta & {
  id: string | number | null;
  kind: PostgresFavoriteMediaKind | null;
  storage_node_id: string | null;
  category_id: string | number | null;
  title: string | null;
  artist: string | null;
  description: string | null;
  file_name: string | null;
  stored_name: string | null;
  mime_type: string | null;
  size_bytes: string | number | null;
  mtime_ms: string | number | null;
  duration_seconds: string | number | null;
  thumbnail_version: string | number | null;
  custom_cover_key: string | null;
  playback_format: "mp4" | "hls" | null;
  playback_version: string | null;
  playback_manifest_path: string | null;
  playback_status: "none" | "pending" | "processing" | "ready" | "failed" | null;
  playback_error: string | null;
  playback_published_at: Date | string | null;
  play_count: string | number | null;
  recommend_count: string | number | null;
  download_count: string | number | null;
  published_at: Date | string | null;
  content_updated_at: Date | string | null;
  new_until: Date | string | null;
  play_soda_price: string | number | null;
  download_soda_price: string | number | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
};

function positiveId(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function count(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function finite(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed;
}

function instant(value: Date | string | null, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value ?? "");
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Invalid PostgreSQL ${label}`);
  return parsed.toISOString();
}

function optionalInstant(value: Date | string | null): string | null {
  return value === null ? null : instant(value, "optional timestamp");
}

function pageValue(value: number | undefined): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 1;
}

function pageSizeValue(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) ? Math.min(Math.max(Number(value), 1), 100) : fallback;
}

function idsValue(values: readonly number[]): number[] {
  if (values.length > 500) throw new TypeError("A favorite batch cannot exceed 500 items");
  const ids = new Set<number>();
  for (const value of values) ids.add(positiveId(value, "favorite id"));
  return [...ids];
}

function mediaKind(value: unknown): PostgresFavoriteMediaKind {
  if (value !== "video" && value !== "audio") throw new TypeError("Invalid PostgreSQL favorite media kind");
  return value;
}

function tagsValue(value: unknown): OriginalArticleRowItem["tags"] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid PostgreSQL original tag");
    const tag = item as Record<string, unknown>;
    if (typeof tag.name !== "string" || typeof tag.slug !== "string") throw new Error("Invalid PostgreSQL original tag");
    return { id: positiveId(tag.id, "original tag id"), name: tag.name, slug: tag.slug };
  });
}

function folderOf(storedName: string): string {
  const normalized = storedName.replace(/\\/gu, "/");
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

async function favoriteState(executor: SqlExecutor, table: string, column: string, userId: number, itemId: number): Promise<boolean> {
  const allowed = table === "user_original_favorites" && column === "article_id" ||
    table === "user_media_favorites" && column === "media_id";
  if (!allowed) throw new Error("Invalid internal favorite target");
  const result = await executor.query<FavoriteRow>({
    text: `SELECT EXISTS (SELECT 1 FROM ${table} WHERE user_id = $1 AND ${column} = $2) AS favorite`,
    values: [positiveId(userId, "user id"), positiveId(itemId, "favorite item id")],
  });
  return result.rows[0]?.favorite === true;
}

export function isPostgresOriginalFavorite(executor: SqlExecutor, userId: number, articleId: number): Promise<boolean> {
  return favoriteState(executor, "user_original_favorites", "article_id", userId, articleId);
}

export function isPostgresMediaFavorite(executor: SqlExecutor, userId: number, mediaId: number): Promise<boolean> {
  return favoriteState(executor, "user_media_favorites", "media_id", userId, mediaId);
}

async function toggleFavorite(
  userIdValue: number,
  itemIdValue: number,
  kind: "original" | "media",
  transaction: TransactionRunner,
): Promise<{ ok: boolean; favorite: boolean }> {
  const userId = positiveId(userIdValue, "user id");
  const itemId = positiveId(itemIdValue, `${kind} id`);
  const table = kind === "original" ? "user_original_favorites" : "user_media_favorites";
  const column = kind === "original" ? "article_id" : "media_id";
  const source = kind === "original" ? "original_articles" : "media_assets";
  const sourceCondition = kind === "original" ? "AND item.status = 'published'" : "AND item.kind IN ('video', 'audio')";
  return transaction(async (tx) => {
    await tx.query({
      text: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      values: [`${kind}-favorite:${userId}:${itemId}`],
    });
    const removed = await tx.query({
      text: `DELETE FROM ${table} WHERE user_id = $1 AND ${column} = $2`,
      values: [userId, itemId],
    });
    if (removed.rowCount) return { ok: true, favorite: false };
    const added = await tx.query({
      text: `INSERT INTO ${table} (user_id, ${column})
        SELECT $1, item.id FROM ${source} item
        JOIN users account ON account.id = $1 AND account.status = 'active' AND account.deleted_at IS NULL
        WHERE item.id = $2 ${sourceCondition}
        ON CONFLICT (user_id, ${column}) DO NOTHING`,
      values: [userId, itemId],
    });
    return { ok: added.rowCount === 1, favorite: added.rowCount === 1 };
  });
}

export function togglePostgresOriginalFavorite(
  userId: number,
  articleId: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
) {
  return toggleFavorite(userId, articleId, "original", transaction);
}

export function togglePostgresMediaFavorite(
  userId: number,
  mediaId: number,
  transaction: TransactionRunner = (operation) => withTransaction(operation),
) {
  return toggleFavorite(userId, mediaId, "media", transaction);
}

async function removeFavorites(
  executor: SqlExecutor,
  userIdValue: number,
  values: readonly number[],
  kind: "original" | PostgresFavoriteMediaKind,
): Promise<number> {
  const userId = positiveId(userIdValue, "user id");
  const ids = idsValue(values);
  if (!ids.length) return 0;
  const original = kind === "original";
  const table = original ? "user_original_favorites" : "user_media_favorites";
  const column = original ? "article_id" : "media_id";
  const target = original ? "original_articles" : "media_assets";
  const constraint = original ? "item.status = 'published'" : "item.kind = $3";
  const result = await executor.query({
    text: `DELETE FROM ${table} favorite
      USING ${target} item
      WHERE favorite.user_id = $1 AND favorite.${column} = item.id
        AND item.id = ANY($2::bigint[]) AND ${constraint}`,
    values: original ? [userId, ids] : [userId, ids, mediaKind(kind)],
  });
  return result.rowCount ?? 0;
}

export function removePostgresOriginalFavorites(executor: SqlExecutor, userId: number, ids: readonly number[]) {
  return removeFavorites(executor, userId, ids, "original");
}

export function removePostgresMediaFavorites(
  executor: SqlExecutor,
  userId: number,
  kind: PostgresFavoriteMediaKind,
  ids: readonly number[],
) {
  return removeFavorites(executor, userId, ids, mediaKind(kind));
}

export async function listPostgresFavoriteOriginals(
  executor: SqlExecutor,
  userIdValue: number,
  options: { page?: number; pageSize?: number } = {},
): Promise<PostgresFavoritePage<OriginalArticleRowItem>> {
  const userId = positiveId(userIdValue, "user id");
  const requestedPage = pageValue(options.page);
  const pageSize = pageSizeValue(options.pageSize, 20);
  const result = await executor.query<OriginalRow>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items,
               GREATEST(CEIL(COUNT(*)::numeric / $3::integer), 1)::bigint AS total_pages
        FROM user_original_favorites favorite
        JOIN original_articles article ON article.id = favorite.article_id AND article.status = 'published'
        WHERE favorite.user_id = $1
      ), requested AS (
        SELECT total_items, total_pages, LEAST(GREATEST($2::bigint, 1), total_pages) AS page FROM page_info
      )
      SELECT requested.*, item.* FROM requested
      LEFT JOIN LATERAL (
        SELECT article.id, article.slug, article.author_id, account.display_name AS author_name,
               account.avatar_path AS author_avatar_path, article.title, article.word_count,
               article.unlock_soda_price, article.status, article.is_pinned, article.comment_count,
               article.created_at, article.published_at,
               COALESCE((SELECT jsonb_agg(jsonb_build_object('id', tag.id, 'name', tag.name, 'slug', tag.slug)
                 ORDER BY lower(tag.name) COLLATE "C", tag.id)
                 FROM original_article_tags relation JOIN original_tags tag ON tag.id = relation.tag_id
                 WHERE relation.article_id = article.id), '[]'::jsonb) AS tags
        FROM user_original_favorites favorite
        JOIN original_articles article ON article.id = favorite.article_id AND article.status = 'published'
        JOIN users account ON account.id = article.author_id
        WHERE favorite.user_id = $1
        ORDER BY favorite.created_at DESC, favorite.article_id DESC
        LIMIT $3::integer OFFSET ((requested.page - 1) * $3::integer)
      ) item ON TRUE`,
    values: [userId, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL favorite original page metadata is missing");
  const items = result.rows.flatMap((row): OriginalArticleRowItem[] => row.id === null ? [] : [{
    id: positiveId(row.id, "favorite original id"),
    slug: row.slug ?? "",
    authorId: positiveId(row.author_id, "favorite original author id"),
    authorName: row.author_name ?? "",
    authorAvatarPath: row.author_avatar_path,
    title: row.title ?? "",
    wordCount: count(row.word_count, "favorite original word count"),
    unlockSodaPrice: count(row.unlock_soda_price, "favorite original price"),
    status: row.status ?? "published",
    isPinned: row.is_pinned === true,
    commentCount: count(row.comment_count, "favorite original comment count"),
    createdAt: instant(row.created_at, "favorite original creation timestamp"),
    publishedAt: optionalInstant(row.published_at),
    tags: tagsValue(row.tags),
  }]);
  return {
    items,
    page: count(first.page, "favorite original page"),
    pageSize,
    totalItems: count(first.total_items, "favorite original total"),
    totalPages: count(first.total_pages, "favorite original total pages"),
  };
}

export async function listPostgresFavoriteMedia(
  executor: SqlExecutor,
  userIdValue: number,
  kindValue: PostgresFavoriteMediaKind,
  options: { page?: number; pageSize?: number } = {},
): Promise<PostgresFavoritePage<PostgresFavoriteMedia>> {
  const userId = positiveId(userIdValue, "user id");
  const kind = mediaKind(kindValue);
  const requestedPage = pageValue(options.page);
  const pageSize = pageSizeValue(options.pageSize, kind === "audio" ? 50 : 30);
  const result = await executor.query<MediaRow>({
    text: `WITH page_info AS (
        SELECT COUNT(*)::bigint AS total_items,
               GREATEST(CEIL(COUNT(*)::numeric / $4::integer), 1)::bigint AS total_pages
        FROM user_media_favorites favorite JOIN media_assets media ON media.id = favorite.media_id
        WHERE favorite.user_id = $1 AND media.kind = $2
      ), requested AS (
        SELECT total_items, total_pages, LEAST(GREATEST($3::bigint, 1), total_pages) AS page FROM page_info
      )
      SELECT requested.*, item.* FROM requested
      LEFT JOIN LATERAL (
        SELECT media.* FROM user_media_favorites favorite
        JOIN media_assets media ON media.id = favorite.media_id
        WHERE favorite.user_id = $1 AND media.kind = $2
        ORDER BY favorite.created_at DESC, favorite.media_id DESC
        LIMIT $4::integer OFFSET ((requested.page - 1) * $4::integer)
      ) item ON TRUE`,
    values: [userId, kind, requestedPage, pageSize],
  });
  const first = result.rows[0];
  if (!first) throw new Error("PostgreSQL favorite media page metadata is missing");
  const items = result.rows.flatMap((row): PostgresFavoriteMedia[] => {
    if (row.id === null) return [];
    const storedName = row.stored_name ?? "";
    return [{
      id: positiveId(row.id, "favorite media id"),
      kind: mediaKind(row.kind),
      storageNodeId: row.storage_node_id,
      categoryId: row.category_id === null ? null : positiveId(row.category_id, "favorite media category id"),
      title: row.title ?? "",
      artist: row.artist ?? "",
      description: row.description ?? "",
      fileName: row.file_name ?? "",
      storedName,
      folder: folderOf(storedName),
      mimeType: row.mime_type ?? "application/octet-stream",
      sizeBytes: count(row.size_bytes, "favorite media size"),
      mtimeMs: count(row.mtime_ms, "favorite media modification time"),
      durationSeconds: row.duration_seconds === null ? null : finite(row.duration_seconds, "favorite media duration"),
      thumbnailVersion: count(row.thumbnail_version, "favorite media thumbnail version"),
      customCoverKey: row.custom_cover_key,
      playbackFormat: row.playback_format ?? "mp4",
      playbackVersion: row.playback_version ?? "",
      playbackManifestPath: row.playback_manifest_path,
      playbackStatus: row.playback_status ?? "none",
      playbackError: row.playback_error ?? "",
      playbackPublishedAt: optionalInstant(row.playback_published_at),
      playCount: count(row.play_count, "favorite media play count"),
      recommendCount: count(row.recommend_count, "favorite media recommendation count"),
      downloadCount: count(row.download_count, "favorite media download count"),
      publishedAt: instant(row.published_at, "favorite media publish timestamp"),
      contentUpdatedAt: instant(row.content_updated_at, "favorite media content timestamp"),
      newUntil: optionalInstant(row.new_until),
      playSodaPrice: count(row.play_soda_price, "favorite media play price"),
      downloadSodaPrice: count(row.download_soda_price, "favorite media download price"),
      createdAt: instant(row.created_at, "favorite media creation timestamp"),
      updatedAt: instant(row.updated_at, "favorite media update timestamp"),
    }];
  });
  return {
    items,
    page: count(first.page, "favorite media page"),
    pageSize,
    totalItems: count(first.total_items, "favorite media total"),
    totalPages: count(first.total_pages, "favorite media total pages"),
  };
}
