import { isNovelLibraryPublic } from "@/lib/config";
import { database } from "@/core/db/postgres";
import { getPostgresSitemapCounts, listPostgresNovelSitemapPage } from "@/domains/navigation/postgres-sitemaps";
import { absoluteSiteUrl } from "@/lib/seo";
import {
  BOOKS_PER_SITEMAP,
  getBookSitemapPageCount,
  parseBookSitemapPage,
  renderUrlSet,
  sitemapResponse,
  type SitemapUrl,
} from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ page: string }> }) {
  const { page: pageValue } = await context.params;
    const novelsPublic = isNovelLibraryPublic();
    const bookCount = novelsPublic ? (await getPostgresSitemapCounts(database("web"))).novels : 0;
    const page = parseBookSitemapPage(pageValue, getBookSitemapPageCount(bookCount));
    if (!page) return new Response("Not found", { status: 404 });

    const entries: SitemapUrl[] = page === 1
      ? [{ url: absoluteSiteUrl("/"), changeFrequency: "daily", priority: 1 }]
      : [];
    if (!novelsPublic) return sitemapResponse(renderUrlSet(entries));

    if (page === 1) {
      entries.push({ url: absoluteSiteUrl("/novels"), changeFrequency: "daily", priority: 0.9 });
    }
    const novels = await listPostgresNovelSitemapPage(database("web"), BOOKS_PER_SITEMAP, (page - 1) * BOOKS_PER_SITEMAP);
    entries.push(...novels.map((novel) => ({
      url: absoluteSiteUrl(`/books/${novel.id}`),
      lastModified: novel.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })));

    return sitemapResponse(renderUrlSet(entries));
}
