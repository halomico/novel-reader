import { absoluteSiteUrl } from "@/lib/seo";
import { canAccessHomeAnnouncementCard } from "@/lib/config";
import { database } from "@/core/db/postgres";
import { listPostgresVisibleAnnouncements } from "@/domains/station/postgres-station";
import { renderUrlSet, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!canAccessHomeAnnouncementCard(false)) {
    return new Response("Not found", { status: 404 });
  }
  const announcements = await listPostgresVisibleAnnouncements(database("web"), false, 200);
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
