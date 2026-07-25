import { absoluteSiteUrl } from "@/lib/seo";
import { listVisibleAnnouncements } from "@/lib/station";
import { renderUrlSet, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export function GET() {
  const announcements = listVisibleAnnouncements(false, 200);
  if (!announcements.length) {
    return new Response("Not found", { status: 404 });
  }
  return sitemapResponse(renderUrlSet([
    { url: absoluteSiteUrl("/announcements"), changeFrequency: "weekly", priority: 0.5 },
    ...announcements.map((announcement) => ({
      url: absoluteSiteUrl(`/announcements/${announcement.id}`),
      lastModified: announcement.updatedAt,
      changeFrequency: "monthly" as const,
      priority: announcement.importance === "important" ? 0.6 : 0.4,
    })),
  ]));
}
