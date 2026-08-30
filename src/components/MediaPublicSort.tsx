"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "@/components/LocalizedLink";
import type { MediaKind, MediaSortBy, MediaSortOrder } from "@/lib/media";
import { beginNavigationProgress } from "./NavigationProgress";
import { uiText, withLocalePath, type AppLocale } from "@/lib/locale";

export function MediaPublicSort({
  kind,
  folder,
  query,
  category,
  tag,
  sortBy,
  sortOrder,
  locale,
}: {
  kind: MediaKind;
  folder: string;
  query: string;
  category: string;
  tag?: string;
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  locale: AppLocale;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const options: Array<{ value: MediaSortBy; label: string }> = kind === "file"
    ? [{ value: "name", label: uiText(locale, "名称") }, { value: "size", label: uiText(locale, "大小") }]
    : kind === "video"
      ? [
          { value: "published", label: uiText(locale, "最新") },
          { value: "name", label: uiText(locale, "名称") },
          { value: "duration", label: uiText(locale, "时长") },
          { value: "plays", label: uiText(locale, "播放量") },
        ]
      : [{ value: "name", label: uiText(locale, "名称") }, { value: "duration", label: uiText(locale, "时长") }];

  const activeOption = options.find((option) => option.value === sortBy) || options[0];
  const defaultSort: MediaSortBy = kind === "video" ? "published" : kind === "audio" && !folder ? "duration" : "name";
  const defaultOrder: MediaSortOrder = defaultSort === "name" ? "asc" : "desc";
  const sortCustomized = sortBy !== defaultSort || sortOrder !== defaultOrder;
  const sortDescription = `${uiText(locale, "排序")}：${activeOption.label}，${uiText(locale, sortOrder === "asc" ? "升序" : "降序")}`;

  useEffect(() => {
    if (!open) return;
    function closeFromPointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder) {
    const params = new URLSearchParams({ kind });
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (kind === "video" && tag) params.set("tag", tag);
    if (nextSort !== defaultSort) params.set("sort", nextSort);
    if (nextOrder !== (nextSort === "name" ? "asc" : "desc")) params.set("order", nextOrder);
    setOpen(false);
    beginNavigationProgress();
    router.push(withLocalePath(`/media?${params.toString()}`, locale));
  }

  function selectSort(nextSort: MediaSortBy) {
    navigate(
      nextSort,
      nextSort === sortBy ? sortOrder === "asc" ? "desc" : "asc" : nextSort === "name" ? "asc" : "desc",
    );
  }

  return (
    <div className="mediaBrowseControls" ref={containerRef}>
      {kind === "video" ? (
        <Link
          className="catalogMenuTrigger"
          href="/media/tags"
          aria-label={uiText(locale, "视频标签")}
          title={uiText(locale, "视频标签")}
          onClick={beginNavigationProgress}
        >
          <Tags size={16} aria-hidden="true" />
        </Link>
      ) : null}
      <div className="catalogMenuControl">
        <button
          className={"catalogMenuTrigger" + (open || sortCustomized ? " isActive" : "")}
          type="button"
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label={sortDescription}
          title={sortDescription}
          onClick={() => setOpen((current) => !current)}
        >
          <ArrowUpDown size={16} aria-hidden="true" />
        </button>
        {open ? (
          <div className="catalogMenuPopover catalogSortPopover" role="menu" aria-label={uiText(locale, "排序")}>
            {options.map((option) => {
              const active = option.value === sortBy;
              return (
                <button
                  className={active ? "catalogMenuItem isActive" : "catalogMenuItem"}
                  type="button"
                  role="menuitem"
                  onClick={() => selectSort(option.value)}
                  key={option.value}
                >
                  <span>{option.label}</span>
                  {active ? sortOrder === "asc"
                    ? <ArrowUp size={14} aria-hidden="true" />
                    : <ArrowDown size={14} aria-hidden="true" />
                  : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
