import type { QueryResultRow } from "pg";
import type { SqlExecutor } from "@/core/db/postgres";
import type { HomePortalCardKey } from "@/lib/home-portal";

export type PostgresHomeOverviewItem = { count: number; updatedAt: number | null };

type OverviewRow = QueryResultRow & Record<string, unknown> & {
  novel_count: string | number;
  novel_updated_at: Date | string | null;
  announcement_count: string | number;
  announcement_updated_at: Date | string | null;
  tag_count: string | number;
  tag_updated_at: Date | string | null;
  original_count: string | number;
  original_updated_at: Date | string | null;
  video_count: string | number;
  video_updated_at: Date | string | null;
  audio_count: string | number;
  audio_updated_at: Date | string | null;
  file_count: string | number;
  file_updated_at: Date | string | null;
};

function count(value: string | number, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`Invalid PostgreSQL home ${name} count`);
  return parsed;
}

function instant(value: Date | string | null, name: string): number | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid PostgreSQL home ${name} timestamp`);
  return parsed;
}

export async function getPostgresHomeOverview(
  executor: SqlExecutor,
  authenticated: boolean,
): Promise<Record<HomePortalCardKey, PostgresHomeOverviewItem>> {
  const result = await executor.query<OverviewRow>({
    name: "navigation-home-overview-v1",
    text: `SELECT
      (SELECT count(*)::bigint FROM novels) AS novel_count,
      (SELECT to_timestamp(max(mtime_ms) / 1000.0) FROM novels) AS novel_updated_at,
      (SELECT count(*)::bigint FROM announcements
        WHERE status = 'published' AND published_at IS NOT NULL
          AND display_mode IN ('list', 'both') AND published_at <= clock_timestamp()
          AND (expires_at IS NULL OR expires_at > clock_timestamp())
          AND ($1::boolean OR audience = 'public')) AS announcement_count,
      (SELECT max(coalesce(published_at, updated_at)) FROM announcements
        WHERE status = 'published' AND published_at IS NOT NULL
          AND display_mode IN ('list', 'both') AND published_at <= clock_timestamp()
          AND (expires_at IS NULL OR expires_at > clock_timestamp())
          AND ($1::boolean OR audience = 'public')) AS announcement_updated_at,
      (SELECT count(*)::bigint FROM tags WHERE ($1::boolean AND visibility <> 'hidden') OR visibility = 'public') AS tag_count,
      (SELECT max(updated_at) FROM tags WHERE ($1::boolean AND visibility <> 'hidden') OR visibility = 'public') AS tag_updated_at,
      (SELECT count(*)::bigint FROM original_articles WHERE status = 'published') AS original_count,
      (SELECT max(coalesce(published_at, updated_at)) FROM original_articles WHERE status = 'published') AS original_updated_at,
      count(*) FILTER (WHERE media.kind = 'video')::bigint AS video_count,
      max(media.content_updated_at) FILTER (WHERE media.kind = 'video') AS video_updated_at,
      count(*) FILTER (WHERE media.kind = 'audio')::bigint AS audio_count,
      max(media.content_updated_at) FILTER (WHERE media.kind = 'audio') AS audio_updated_at,
      count(*) FILTER (WHERE media.kind = 'file')::bigint AS file_count,
      max(media.content_updated_at) FILTER (WHERE media.kind = 'file') AS file_updated_at
      FROM media_assets media`,
    values: [authenticated],
  });
  const row = result.rows[0];
  if (!row) throw new Error("PostgreSQL home overview did not return a row");
  return {
    novels: { count: count(row.novel_count, "novel"), updatedAt: instant(row.novel_updated_at, "novel") },
    announcement: { count: count(row.announcement_count, "announcement"), updatedAt: instant(row.announcement_updated_at, "announcement") },
    tags: { count: count(row.tag_count, "tag"), updatedAt: instant(row.tag_updated_at, "tag") },
    original: { count: count(row.original_count, "original"), updatedAt: instant(row.original_updated_at, "original") },
    video: { count: count(row.video_count, "video"), updatedAt: instant(row.video_updated_at, "video") },
    audio: { count: count(row.audio_count, "audio"), updatedAt: instant(row.audio_updated_at, "audio") },
    file: { count: count(row.file_count, "file"), updatedAt: instant(row.file_updated_at, "file") },
  };
}

export function formatPostgresHomeUpdateTime(timestamp: number | null, now = Date.now()): string {
  if (!timestamp) return "暂无更新";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}分钟前`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}小时前`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))}天前`;
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
