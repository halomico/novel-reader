import { getDb } from "@/lib/db";
import {
  isMediaKindPublic,
  listMediaFolders,
  listVideoCategories,
  listVideoTags,
  type MediaKind,
} from "@/lib/media";
import { absoluteSiteUrl } from "@/lib/seo";
import { renderUrlSet, sitemapResponse, type SitemapUrl } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

type UpdatedRow = {
  id: number;
  updated_at: string;
};

function mediaListUrl(kind: MediaKind, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ kind, ...extra });
  return absoluteSiteUrl(`/media?${params.toString()}`);
}

export function GET() {
  const publicKinds = (["video", "audio", "file"] as MediaKind[]).filter(isMediaKindPublic);
  if (!publicKinds.length) return new Response("Not found", { status: 404 });

  const entries: SitemapUrl[] = [];
  for (const kind of publicKinds) {
    entries.push({ url: mediaListUrl(kind), changeFrequency: "daily", priority: 0.6 });
    if (kind === "video") {
      entries.push({ url: absoluteSiteUrl("/media/tags"), changeFrequency: "weekly", priority: 0.5 });
      entries.push(...listVideoCategories().map((category) => ({
        url: mediaListUrl(kind, { category: String(category.id) }),
        lastModified: category.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })));
      entries.push(...listVideoTags({ pageSize: 5_000 }).tags.map((tag) => ({
        url: mediaListUrl(kind, { tag: tag.slug }),
        lastModified: tag.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })));
    } else {
      entries.push(...listMediaFolders(kind).map((folder) => ({
        url: mediaListUrl(kind, { folder: folder.path }),
        lastModified: new Date(folder.mtimeMs),
        changeFrequency: "weekly" as const,
        priority: 0.5,
      })));
    }
  }

  const placeholders = publicKinds.map(() => "?").join(", ");
  const assets = getDb()
    .prepare(`SELECT id, updated_at FROM media_assets WHERE kind IN (${placeholders}) ORDER BY id ASC`)
    .all(...publicKinds) as UpdatedRow[];
  entries.push(...assets.map((asset) => ({
    url: absoluteSiteUrl(`/media/${asset.id}`),
    lastModified: asset.updated_at,
    changeFrequency: "monthly" as const,
    priority: 0.5,
  })));

  return sitemapResponse(renderUrlSet(entries));
}
