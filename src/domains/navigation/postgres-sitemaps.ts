import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";

export type SitemapMediaKind = "video" | "audio" | "file";
export type SitemapCounts = Readonly<{ novels: number; originals: number; announcements: number }>;
export type SitemapUpdatedItem = Readonly<{ id: number; updatedAt: string }>;
export type SitemapOriginalItem = Readonly<{ slug: string; updatedAt: string }>;
export type SitemapMediaCategory = Readonly<{ id: number; updatedAt: string }>;
export type SitemapMediaTag = Readonly<{ slug: string; updatedAt: string }>;
export type SitemapNovelTag = Readonly<{ slug: string; updatedAt: string }>;
export type SitemapMediaFolder = Readonly<{ kind: SitemapMediaKind; path: string; updatedAt: string }>;
export type SitemapMediaData = Readonly<{
  assets: SitemapUpdatedItem[];
  categories: SitemapMediaCategory[];
  tags: SitemapMediaTag[];
  folders: SitemapMediaFolder[];
}>;

function integer(value: string | number, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Invalid PostgreSQL " + label);
  return parsed;
}

function timestamp(value: Date | string, label: string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid PostgreSQL " + label);
  return parsed.toISOString();
}

export async function getPostgresSitemapCounts(executor: SqlExecutor): Promise<SitemapCounts> {
  const result = await executor.query<QueryResultRow & {
    novels: string | number;
    originals: string | number;
    announcements: string | number;
  }>({
    name: "navigation-sitemap-counts-v1",
    text: `SELECT
      (SELECT COUNT(*) FROM novels) AS novels,
      (SELECT COUNT(*) FROM original_articles WHERE status = 'published') AS originals,
      (SELECT COUNT(*) FROM announcements
        WHERE status = 'published' AND audience = 'public' AND published_at IS NOT NULL
          AND published_at <= clock_timestamp() AND (expires_at IS NULL OR expires_at > clock_timestamp())
      ) AS announcements`,
  });
  const row = result.rows[0];
  return {
    novels: integer(row?.novels ?? 0, "sitemap novel count"),
    originals: integer(row?.originals ?? 0, "sitemap original count"),
    announcements: integer(row?.announcements ?? 0, "sitemap announcement count"),
  };
}

export async function listPostgresNovelSitemapPage(
  executor: SqlExecutor,
  limitValue: number,
  offsetValue: number,
): Promise<SitemapUpdatedItem[]> {
  const limit = Math.min(Math.max(Math.floor(limitValue), 1), 50_000);
  const offset = Math.max(Math.floor(offsetValue), 0);
  const result = await executor.query<QueryResultRow & { id: number; updated_at: Date | string }>({
    text: "SELECT id, updated_at FROM novels ORDER BY id ASC LIMIT $1 OFFSET $2",
    values: [limit, offset],
  });
  return result.rows.map((row) => ({ id: integer(row.id, "sitemap novel id"), updatedAt: timestamp(row.updated_at, "sitemap novel time") }));
}

export async function listPostgresOriginalSitemap(executor: SqlExecutor): Promise<SitemapOriginalItem[]> {
  const result = await executor.query<QueryResultRow & { slug: string; updated_at: Date | string }>({
    name: "navigation-original-sitemap-v1",
    text: `SELECT slug, COALESCE(published_at, updated_at) AS updated_at
      FROM original_articles WHERE status = 'published'
      ORDER BY COALESCE(published_at, updated_at) DESC, id DESC LIMIT 50000`,
  });
  return result.rows.map((row) => ({ slug: row.slug, updatedAt: timestamp(row.updated_at, "sitemap original time") }));
}

export async function listPostgresNovelTagSitemap(executor: SqlExecutor): Promise<SitemapNovelTag[]> {
  const result = await executor.query<QueryResultRow & { slug: string; updated_at: Date | string }>({
    name: "navigation-novel-tag-sitemap-v1",
    text: `SELECT tag.slug, tag.updated_at
      FROM tags tag
      WHERE tag.visibility = 'public'
        AND EXISTS (SELECT 1 FROM novel_tags relation WHERE relation.tag_id = tag.id)
      ORDER BY tag.id ASC LIMIT 50000`,
  });
  return result.rows.map((row) => ({
    slug: row.slug,
    updatedAt: timestamp(row.updated_at, "sitemap novel tag time"),
  }));
}

export async function getPostgresMediaSitemapData(
  executor: SqlExecutor,
  publicKinds: readonly SitemapMediaKind[],
): Promise<SitemapMediaData> {
  const kinds = [...new Set(publicKinds)];
  if (!kinds.length) return { assets: [], categories: [], tags: [], folders: [] };
  const includeVideo = kinds.includes("video");
  const [assets, categories, tags, folders] = await Promise.all([
    executor.query<QueryResultRow & { id: string | number; updated_at: Date | string }>({
      text: `SELECT id, updated_at FROM media_assets WHERE kind = ANY($1::text[]) ORDER BY id ASC`,
      values: [kinds],
    }),
    includeVideo
      ? executor.query<QueryResultRow & { id: string | number; updated_at: Date | string }>({
          name: "navigation-media-sitemap-categories-v1",
          text: "SELECT id, updated_at FROM video_categories WHERE is_visible = TRUE ORDER BY sort_order, id",
        })
      : Promise.resolve({ rows: [] }),
    includeVideo
      ? executor.query<QueryResultRow & { slug: string; updated_at: Date | string }>({
          name: "navigation-media-sitemap-tags-v1",
          text: "SELECT slug, updated_at FROM video_tags WHERE is_visible = TRUE ORDER BY sort_order, id LIMIT 5000",
        })
      : Promise.resolve({ rows: [] }),
    executor.query<QueryResultRow & { kind: SitemapMediaKind; path: string; updated_at: Date | string }>({
      text: `WITH base AS (
          SELECT kind,
            string_to_array(regexp_replace(substr(stored_name, length(kind) + 2), '/[^/]+$', ''), '/') AS parts,
            to_timestamp(mtime_ms / 1000.0) AS updated_at
          FROM media_assets
          WHERE kind = ANY($1::text[])
            AND kind <> 'video'
            AND strpos(substr(stored_name, length(kind) + 2), '/') > 0
        ), expanded AS (
          SELECT kind, array_to_string(parts[1:depth], '/') AS path, updated_at
          FROM base CROSS JOIN LATERAL generate_series(1, array_length(parts, 1)) depth
        )
        SELECT kind, path, MAX(updated_at) AS updated_at
        FROM expanded WHERE path <> '' GROUP BY kind, path ORDER BY kind, path`,
      values: [kinds],
    }),
  ]);
  return {
    assets: assets.rows.map((row) => ({
      id: integer(row.id, "sitemap media id"),
      updatedAt: timestamp(row.updated_at, "sitemap media time"),
    })),
    categories: categories.rows.map((row) => ({
      id: integer(row.id, "sitemap media category id"),
      updatedAt: timestamp(row.updated_at, "sitemap media category time"),
    })),
    tags: tags.rows.map((row) => ({ slug: row.slug, updatedAt: timestamp(row.updated_at, "sitemap media tag time") })),
    folders: folders.rows.map((row) => ({
      kind: row.kind,
      path: row.path,
      updatedAt: timestamp(row.updated_at, "sitemap media folder time"),
    })),
  };
}
