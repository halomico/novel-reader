"use client";

import { useRouter } from "next/navigation";
import type { MediaKind, MediaSortBy, MediaSortOrder } from "@/lib/media";
import { MediaSortMenu, type MediaSortOption } from "./MediaSortMenu";
import { beginNavigationProgress } from "./NavigationProgress";

export function MediaPublicSort({
  kind,
  folder,
  query,
  category,
  sortBy,
  sortOrder,
}: {
  kind: MediaKind;
  folder: string;
  query: string;
  category: string;
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
}) {
  const router = useRouter();
  const options: MediaSortOption[] = kind === "file"
    ? [{ value: "name", label: "名称" }, { value: "size", label: "大小" }]
    : [{ value: "name", label: "名称" }, { value: "duration", label: "时长" }];

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder) {
    const params = new URLSearchParams({ kind });
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (nextSort !== "name") params.set("sort", nextSort);
    if (nextOrder === "desc") params.set("order", nextOrder);
    beginNavigationProgress();
    router.push(`/media?${params.toString()}`);
  }

  return <MediaSortMenu options={options} sortBy={sortBy} sortOrder={sortOrder} onChange={navigate} />;
}
