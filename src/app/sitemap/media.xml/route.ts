import { database } from "@/core/db/postgres";
import { getPostgresMediaSitemapData, type SitemapMediaKind } from "@/domains/navigation/postgres-sitemaps";
import { canBrowseHomePortalContent } from "@/lib/config";
import { absoluteSiteUrl } from "@/lib/seo";
import { renderUrlSet, sitemapResponse, type SitemapUrl } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

function mediaListUrl(kind: SitemapMediaKind, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ kind, ...extra });
  return absoluteSiteUrl(`/media?${params.toString()}`);
}

export async function GET() {
  const publicKinds = (["video", "audio", "file"] as SitemapMediaKind[]).filter((kind) => canBrowseHomePortalContent(kind, false));
  if (!publicKinds.length) return new Response("Not found", { status: 404 });
  const data = await getPostgresMediaSitemapData(database("web"), publicKinds);

  const entries: SitemapUrl[] = [];
  for (const kind of publicKinds) {
    entries.push({ url: mediaListUrl(kind), changeFrequency: "daily", priority: 0.6 });
    if (kind === "video") {
      entries.push({ url: absoluteSiteUrl("/media/tags"), changeFrequency: "weekly", priority: 0.5 });
      entries.push(...data.categories.map((category) => ({
        url: mediaListUrl(kind, { category: String(category.id) }),
        lastModified: category.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })));
      entries.push(...data.tags.map((tag) => ({
        url: mediaListUrl(kind, { tag: tag.slug }),
        lastModified: tag.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })));
    } else {
      entries.push(...data.folders.filter((folder) => folder.kind === kind).map((folder) => ({
        url: mediaListUrl(kind, { folder: folder.path }),
        lastModified: folder.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })));
    }
  }

  entries.push(...data.assets.map((asset) => ({
    url: absoluteSiteUrl(`/media/${asset.id}`),
    lastModified: asset.updatedAt,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  })));

  return sitemapResponse(renderUrlSet(entries));
}
