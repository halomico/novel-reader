import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { listPostgresNovelTagSitemap } from "@/domains/navigation/postgres-sitemaps";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { absoluteSiteUrl } from "@/lib/seo";
import { renderUrlSet, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = await readPostgresSiteSettings();
  if (!canBrowseHomePortal(settings.homePortalAccessModes.tags, false)) {
    return new Response("Not found", { status: 404 });
  }
  const tags = await listPostgresNovelTagSitemap(database("web"));
  return sitemapResponse(renderUrlSet([
    { url: absoluteSiteUrl("/tags"), changeFrequency: "weekly", priority: 0.7 },
    ...tags.map((tag) => ({
      url: absoluteSiteUrl(`/tags/${tag.slug}`),
      lastModified: tag.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ]));
}
