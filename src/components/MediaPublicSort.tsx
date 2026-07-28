"use client";

import { useRouter } from "next/navigation";
import type { MediaKind, MediaSortBy, MediaSortOrder } from "@/lib/media";
import { MediaSortMenu, type MediaSortOption } from "./MediaSortMenu";
import { beginNavigationProgress } from "./NavigationProgress";
import { uiText, withLocalePath, type AppLocale } from "@/lib/locale";

export function MediaPublicSort({
  kind,
  folder,
  query,
  category,
  sortBy,
  sortOrder,
  locale,
}: {
  kind: MediaKind;
  folder: string;
  query: string;
  category: string;
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  locale: AppLocale;
}) {
  const router = useRouter();
  const options: MediaSortOption[] = kind === "file"
    ? [{ value: "name", label: uiText(locale, "名称") }, { value: "size", label: uiText(locale, "大小") }]
    : [{ value: "name", label: uiText(locale, "名称") }, { value: "duration", label: uiText(locale, "时长") }];

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder) {
    const defaultSort: MediaSortBy = kind === "audio" && !folder ? "duration" : "name";
    const params = new URLSearchParams({ kind });
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (nextSort !== defaultSort) params.set("sort", nextSort);
    if (nextOrder !== (nextSort === "name" ? "asc" : "desc")) params.set("order", nextOrder);
    beginNavigationProgress();
    router.push(withLocalePath(`/media?${params.toString()}`, locale));
  }

  return <MediaSortMenu options={options} sortBy={sortBy} sortOrder={sortOrder} onChange={navigate} />;
}
