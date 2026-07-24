import { isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { absoluteSiteUrl } from "@/lib/seo";
import { renderUrlSet, sitemapResponse } from "@/lib/sitemap";
import { listTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

export function GET() {
  if (!isTagLibraryEnabled() || !isGuestTagLibraryNavEnabled()) {
    return new Response("Not found", { status: 404 });
  }
  return sitemapResponse(renderUrlSet([
    { url: absoluteSiteUrl("/tags"), changeFrequency: "weekly", priority: 0.7 },
    ...listTags().map((tag) => ({
      url: absoluteSiteUrl(`/tags/${tag.slug}`),
      lastModified: tag.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ]));
}
