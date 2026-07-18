import type { MetadataRoute } from "next";
import { isGuestTagLibraryNavEnabled, isTagLibraryEnabled } from "@/lib/config";
import { getDb } from "@/lib/db";
import {
  isMediaKindPublic,
  listMediaFolders,
  listVideoCategories,
  type MediaKind,
} from "@/lib/media";
import { absoluteSiteUrl } from "@/lib/seo";
import { listTags } from "@/lib/tags";

export const dynamic = "force-dynamic";

type UpdatedRow = {
  id: number;
  updated_at: string;
};

function mediaListUrl(kind: MediaKind, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ kind, ...extra });
  return absoluteSiteUrl(`/media?${params.toString()}`);
}

export default function sitemap(): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [
    {
      url: absoluteSiteUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: absoluteSiteUrl("/novels"),
      changeFrequency: "daily",
      priority: 0.9,
    },
  ];

  const novels = getDb().prepare("SELECT id, updated_at FROM novels ORDER BY id ASC").all() as UpdatedRow[];
  for (const novel of novels) {
    entries.push({
      url: absoluteSiteUrl(`/books/${novel.id}`),
      lastModified: novel.updated_at,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  if (isTagLibraryEnabled() && isGuestTagLibraryNavEnabled()) {
    entries.push({ url: absoluteSiteUrl("/tags"), changeFrequency: "weekly", priority: 0.7 });
    for (const tag of listTags()) {
      entries.push({
        url: absoluteSiteUrl(`/tags/${tag.slug}`),
        lastModified: tag.updatedAt,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  }

  const publicKinds = (["video", "audio", "file"] as MediaKind[]).filter(isMediaKindPublic);
  for (const kind of publicKinds) {
    entries.push({ url: mediaListUrl(kind), changeFrequency: "daily", priority: 0.6 });
    if (kind === "video") {
      for (const category of listVideoCategories()) {
        entries.push({
          url: mediaListUrl(kind, { category: String(category.id) }),
          lastModified: category.updatedAt,
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    } else {
      for (const folder of listMediaFolders(kind)) {
        entries.push({
          url: mediaListUrl(kind, { folder: folder.path }),
          lastModified: new Date(folder.mtimeMs).toISOString(),
          changeFrequency: "weekly",
          priority: 0.5,
        });
      }
    }
  }

  if (publicKinds.length) {
    const placeholders = publicKinds.map(() => "?").join(", ");
    const media = getDb()
      .prepare(`SELECT id, updated_at FROM media_assets WHERE kind IN (${placeholders}) ORDER BY id ASC`)
      .all(...publicKinds) as UpdatedRow[];
    for (const asset of media) {
      entries.push({
        url: absoluteSiteUrl(`/media/${asset.id}`),
        lastModified: asset.updated_at,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  }

  return entries;
}
