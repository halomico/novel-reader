"use client";

import { useRouter } from "next/navigation";
import type { MediaKind, MediaSortBy, MediaSortOrder } from "@/lib/media";
import { MediaSortMenu, type MediaSortOption } from "./MediaSortMenu";
import { beginNavigationProgress } from "./NavigationProgress";

export function AdminMediaSort({
  kind,
  folder,
  query,
  sortBy,
  sortOrder,
  category,
  view,
}: {
  kind?: MediaKind;
  folder: string;
  query: string;
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  category?: string;
  view?: "table" | "grid";
}) {
  const router = useRouter();
  const options: MediaSortOption[] = kind === "video" || kind === "audio"
    ? [
        { value: "name", label: "名称" },
        { value: "duration", label: "时长" },
        { value: "plays", label: "播放次数" },
        { value: "updated", label: "更新时间" },
      ]
    : [
        { value: "name", label: "名称" },
        { value: "size", label: "大小" },
        { value: "updated", label: "更新时间" },
      ];

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder) {
    const params = new URLSearchParams({ sort: nextSort, order: nextOrder });
    if (kind) params.set("kind", kind);
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (kind === "video" && category) params.set("category", category);
    if (kind === "video" && view === "grid") params.set("view", view);
    beginNavigationProgress();
    router.push(`/admin/media?${params.toString()}`);
  }

  return <MediaSortMenu options={options} sortBy={sortBy} sortOrder={sortOrder} onChange={navigate} />;
}
