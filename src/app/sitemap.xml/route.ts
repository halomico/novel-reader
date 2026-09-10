import { canAccessHomeAnnouncementCard, canAccessOriginalChannel, canBrowseHomePortalContent, isNovelLibraryPublic, isTagLibraryEnabled, isTagLibraryPublic } from "@/lib/config";
import { database } from "@/core/db/postgres";
import { getPostgresSitemapCounts, type SitemapMediaKind } from "@/domains/navigation/postgres-sitemaps";
import { absoluteSiteUrl } from "@/lib/seo";
import { getBookSitemapPageCount, renderSitemapIndex, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  const counts = await getPostgresSitemapCounts(database("web"));
  const bookCount = isNovelLibraryPublic() ? counts.novels : 0;
  const urls = Array.from(
    { length: getBookSitemapPageCount(bookCount) },
    (_, index) => absoluteSiteUrl(`/sitemap/books/${index + 1}.xml`),
  );

  if (isTagLibraryEnabled() && isTagLibraryPublic()) {
    urls.push(absoluteSiteUrl("/sitemap/tags.xml"));
  }
  if (canAccessOriginalChannel(false)) {
    if (counts.originals > 0) urls.push(absoluteSiteUrl("/sitemap/original.xml"));
  }
  if ((["video", "audio", "file"] as SitemapMediaKind[]).some((kind) => canBrowseHomePortalContent(kind, false))) {
    urls.push(absoluteSiteUrl("/sitemap/media.xml"));
  }
  if (canAccessHomeAnnouncementCard(false) && counts.announcements > 0) {
    urls.push(absoluteSiteUrl("/sitemap/announcements.xml"));
  }

  return sitemapResponse(renderSitemapIndex(urls));
}
