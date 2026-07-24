import { isGuestTagLibraryNavEnabled, isNovelLibraryPublic, isTagLibraryEnabled } from "@/lib/config";
import { getDb } from "@/lib/db";
import { isMediaKindPublic, type MediaKind } from "@/lib/media";
import { absoluteSiteUrl } from "@/lib/seo";
import { getBookSitemapPageCount, renderSitemapIndex, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export function GET() {
  const bookCount = isNovelLibraryPublic()
    ? (getDb().prepare("SELECT COUNT(*) AS count FROM novels").get() as { count: number }).count
    : 0;
  const urls = Array.from(
    { length: getBookSitemapPageCount(bookCount) },
    (_, index) => absoluteSiteUrl(`/sitemap/books/${index + 1}.xml`),
  );

  if (isTagLibraryEnabled() && isGuestTagLibraryNavEnabled()) {
    urls.push(absoluteSiteUrl("/sitemap/tags.xml"));
  }
  if ((["video", "audio", "file"] as MediaKind[]).some(isMediaKindPublic)) {
    urls.push(absoluteSiteUrl("/sitemap/media.xml"));
  }

  return sitemapResponse(renderSitemapIndex(urls));
}
