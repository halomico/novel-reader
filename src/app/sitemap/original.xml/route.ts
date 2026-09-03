import { canAccessOriginalChannel } from "@/lib/config";
import { getDb } from "@/lib/db";
import { absoluteSiteUrl } from "@/lib/seo";
import { renderUrlSet, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

type OriginalSitemapRow = {
  slug: string;
  published_at: string | null;
  updated_at: string;
};

export function GET() {
  if (!canAccessOriginalChannel(false)) return new Response("Not found", { status: 404 });
  const rows = getDb().prepare(
    `SELECT slug, published_at, updated_at
     FROM original_articles
     WHERE status = 'published'
     ORDER BY COALESCE(published_at, updated_at) DESC, id DESC
     LIMIT 50000`,
  ).all() as OriginalSitemapRow[];
  if (!rows.length) return new Response("Not found", { status: 404 });
  return sitemapResponse(renderUrlSet([
    { url: absoluteSiteUrl("/original"), changeFrequency: "daily", priority: 0.7 },
    ...rows.map((article) => ({
      url: absoluteSiteUrl(`/original/${encodeURIComponent(article.slug)}`),
      lastModified: article.published_at || article.updated_at,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ]));
}
