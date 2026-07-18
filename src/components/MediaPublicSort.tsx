"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import { useRouter } from "next/navigation";
import type { MediaKind } from "@/lib/media";

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
  sortBy: "name" | "size";
  sortOrder: "asc" | "desc";
}) {
  const router = useRouter();

  function navigate(nextSort: "name" | "size", nextOrder: "asc" | "desc") {
    const params = new URLSearchParams({ kind });
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (nextSort === "size") params.set("sort", nextSort);
    if (nextOrder === "desc") params.set("order", nextOrder);
    router.push(`/media?${params.toString()}`);
  }

  return (
    <div className="mediaPublicSort" aria-label="资源排序">
      <button
        className="mediaPublicSortDirection"
        type="button"
        aria-label={sortOrder === "asc" ? "切换为降序" : "切换为升序"}
        title={sortOrder === "asc" ? "当前升序，点击切换为降序" : "当前降序，点击切换为升序"}
        onClick={() => navigate(sortBy, sortOrder === "asc" ? "desc" : "asc")}
      >
        {sortOrder === "asc" ? <ArrowUp size={15} aria-hidden="true" /> : <ArrowDown size={15} aria-hidden="true" />}
      </button>
      <label className="mediaPublicSortField">
        <select
          aria-label="排序字段"
          value={sortBy}
          onChange={(event) => {
            const nextSort = event.target.value === "size" ? "size" : "name";
            navigate(nextSort, nextSort === "name" ? "asc" : "desc");
          }}
        >
          <option value="name">名称</option>
          <option value="size">大小</option>
        </select>
      </label>
    </div>
  );
}
