import { isNovelLibraryPublic } from "@/lib/config";
import { getDb } from "@/lib/db";
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

type UpdatedRow = {
  id: number;
  updated_at: string;
};

export function GET(_request: Request, context: { params: Promise<{ page: string }> }) {
  return context.params.then(({ page: pageValue }) => {
    const novelsPublic = isNovelLibraryPublic();
    const bookCount = novelsPublic
      ? (getDb().prepare("SELECT COUNT(*) AS count FROM novels").get() as { count: number }).count
      : 0;
    const page = parseBookSitemapPage(pageValue, getBookSitemapPageCount(bookCount));
    if (!page) return new Response("Not found", { status: 404 });

    const entries: SitemapUrl[] = page === 1
      ? [{ url: absoluteSiteUrl("/"), changeFrequency: "daily", priority: 1 }]
      : [];
    if (!novelsPublic) return sitemapResponse(renderUrlSet(entries));

    if (page === 1) {
      entries.push({ url: absoluteSiteUrl("/novels"), changeFrequency: "daily", priority: 0.9 });
    }
    const novels = getDb()
      .prepare("SELECT id, updated_at FROM novels ORDER BY id ASC LIMIT ? OFFSET ?")
      .all(BOOKS_PER_SITEMAP, (page - 1) * BOOKS_PER_SITEMAP) as UpdatedRow[];
    entries.push(...novels.map((novel) => ({
      url: absoluteSiteUrl(`/books/${novel.id}`),
      lastModified: novel.updated_at,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })));

    return sitemapResponse(renderUrlSet(entries));
  });
}
