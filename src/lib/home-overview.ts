import { getDb } from "./db";
import type { HomePortalCardKey } from "./home-portal";

export type HomeOverviewItem = { count: number; updatedAt: number | null };

function parseSqliteTime(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatHomeUpdateTime(timestamp: number | null, now = Date.now()): string {
  if (!timestamp) return "暂无更新";
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 60 * 60_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}分钟前`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}小时前`;
  if (elapsed < 7 * 24 * 60 * 60_000) return `${Math.floor(elapsed / (24 * 60 * 60_000))}天前`;
  const date = new Date(timestamp);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getHomeOverview(authenticated: boolean): Partial<Record<HomePortalCardKey, HomeOverviewItem>> {
  const db = getDb();
  const novel = db.prepare(
    "SELECT COUNT(*) AS count, MAX(mtime_ms) AS updated FROM novels",
  ).get() as { count: number; updated: number | null };
  const announcement = db.prepare(
    `SELECT COUNT(*) AS count, MAX(COALESCE(published_at, updated_at)) AS updated
     FROM announcements
     WHERE status = 'published' AND published_at IS NOT NULL
       AND display_mode IN ('list', 'both')
       AND datetime(published_at) <= CURRENT_TIMESTAMP
       AND (expires_at IS NULL OR datetime(expires_at) > CURRENT_TIMESTAMP)
       ${authenticated ? "" : "AND audience = 'public'"}`,
  ).get() as { count: number; updated: string | null };
  const tags = db.prepare(
    `SELECT COUNT(*) AS count, MAX(updated_at) AS updated FROM tags WHERE visibility ${authenticated ? "<> 'hidden'" : "= 'public'"}`,
  ).get() as { count: number; updated: string | null };
  const overview: Partial<Record<HomePortalCardKey, HomeOverviewItem>> = {
    novels: { count: novel.count, updatedAt: novel.updated },
    announcement: { count: announcement.count, updatedAt: parseSqliteTime(announcement.updated) },
    tags: { count: tags.count, updatedAt: parseSqliteTime(tags.updated) },
  };
  for (const kind of ["video", "audio", "file"] as const) {
    const row = db.prepare("SELECT COUNT(*) AS count, MAX(content_updated_at) AS updated FROM media_assets WHERE kind = ?")
      .get(kind) as { count: number; updated: string | null };
    overview[kind] = { count: row.count, updatedAt: parseSqliteTime(row.updated) };
  }
  return overview;
}
