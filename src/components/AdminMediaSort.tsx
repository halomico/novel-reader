"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { MediaKind, MediaSortBy, MediaSortOrder } from "@/lib/media";

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
  const [selectedSort, setSelectedSort] = useState(sortBy);

  useEffect(() => setSelectedSort(sortBy), [sortBy]);

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder) {
    const params = new URLSearchParams({ sort: nextSort, order: nextOrder });
    if (kind) params.set("kind", kind);
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (kind === "video" && category) params.set("category", category);
    if (kind === "video" && view === "grid") params.set("view", view);
    router.push(`/admin/media?${params.toString()}`);
  }

  return (
    <div className="adminMediaSort" aria-label="资源排序">
      <button
        className="adminMediaSortDirection"
        type="button"
        aria-label={sortOrder === "asc" ? "切换为降序" : "切换为升序"}
        title={sortOrder === "asc" ? "当前升序，点击切换为降序" : "当前降序，点击切换为升序"}
        onClick={() => navigate(selectedSort, sortOrder === "asc" ? "desc" : "asc")}
      >
        {sortOrder === "asc" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
      </button>
      <label className="adminMediaSortField">
        <select
          aria-label="排序字段"
          value={selectedSort}
          onChange={(event) => {
            const nextSort = event.target.value as MediaSortBy;
            const nextOrder = nextSort === "name" ? "asc" : "desc";
            setSelectedSort(nextSort);
            navigate(nextSort, nextOrder);
          }}
        >
          <option value="name">名称</option>
          <option value="size">大小</option>
          {kind === "video" || kind === "audio" ? <option value="plays">播放次数</option> : null}
          <option value="updated">更新时间</option>
        </select>
      </label>
    </div>
  );
}
