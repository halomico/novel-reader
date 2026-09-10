import { canAccessOriginalChannel } from "@/lib/config";
import { database } from "@/core/db/postgres";
import { listPostgresOriginalSitemap } from "@/domains/navigation/postgres-sitemaps";
import { absoluteSiteUrl } from "@/lib/seo";
import { renderUrlSet, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!canAccessOriginalChannel(false)) return new Response("Not found", { status: 404 });
  const rows = await listPostgresOriginalSitemap(database("web"));
  if (!rows.length) return new Response("Not found", { status: 404 });
  return sitemapResponse(renderUrlSet([
    { url: absoluteSiteUrl("/original"), changeFrequency: "daily", priority: 0.7 },
    ...rows.map((article) => ({
      url: absoluteSiteUrl(`/original/${encodeURIComponent(article.slug)}`),
      lastModified: article.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ]));
}
