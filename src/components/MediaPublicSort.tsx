"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Check, Tags } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { MediaKind, MediaSortBy, MediaSortOrder, VideoTag } from "@/lib/media";
import { beginNavigationProgress } from "./NavigationProgress";
import { uiText, withLocalePath, type AppLocale } from "@/lib/locale";

const TAG_RESULT_LIMIT = 40;

export function MediaPublicSort({
  kind,
  folder,
  query,
  category,
  tag,
  tags = [],
  sortBy,
  sortOrder,
  locale,
}: {
  kind: MediaKind;
  folder: string;
  query: string;
  category: string;
  tag?: string;
  tags?: VideoTag[];
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  locale: AppLocale;
}) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [openPanel, setOpenPanel] = useState<"sort" | "tags" | null>(null);
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

  const quickTags = tags.slice(0, TAG_RESULT_LIMIT);
  const activeOption = options.find((option) => option.value === sortBy) || options[0];
  const defaultSort: MediaSortBy = kind === "video" ? "published" : kind === "audio" && !folder ? "duration" : "name";
  const defaultOrder: MediaSortOrder = defaultSort === "name" ? "asc" : "desc";
  const sortCustomized = sortBy !== defaultSort || sortOrder !== defaultOrder;
  const sortDescription = `${uiText(locale, "排序")}：${activeOption.label}，${uiText(locale, sortOrder === "asc" ? "升序" : "降序")}`;

  useEffect(() => {
    if (!openPanel) return;
    function closeFromPointer(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpenPanel(null);
    }
    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenPanel(null);
    }
    document.addEventListener("pointerdown", closeFromPointer);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromPointer);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [openPanel]);

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder, nextTag = tag || "") {
    const params = new URLSearchParams({ kind });
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (kind === "video" && nextTag) params.set("tag", nextTag);
    if (nextSort !== defaultSort) params.set("sort", nextSort);
    if (nextOrder !== (nextSort === "name" ? "asc" : "desc")) params.set("order", nextOrder);
    setOpenPanel(null);
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
      <div className="catalogMenuControl">
        <button
          className={"catalogMenuTrigger" + (openPanel === "sort" || sortCustomized ? " isActive" : "")}
          type="button"
          aria-expanded={openPanel === "sort"}
          aria-haspopup="menu"
          aria-label={sortDescription}
          title={sortDescription}
          onClick={() => setOpenPanel((current) => current === "sort" ? null : "sort")}
        >
          <ArrowUpDown size={16} aria-hidden="true" />
        </button>
        {openPanel === "sort" ? (
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

      {kind === "video" ? (
        <div className="catalogMenuControl">
          <button
            className={"catalogMenuTrigger" + (openPanel === "tags" || tag ? " isActive" : "")}
            type="button"
            aria-expanded={openPanel === "tags"}
            aria-haspopup="menu"
            aria-label={uiText(locale, "筛选标签")}
            title={uiText(locale, "筛选标签")}
            onClick={() => setOpenPanel((current) => current === "tags" ? null : "tags")}
          >
            <Tags size={16} aria-hidden="true" />
          </button>
          {openPanel === "tags" ? (
            <div className="catalogMenuPopover catalogTagPopover" role="menu" aria-label={uiText(locale, "筛选标签")}>
              <button className={!tag ? "catalogTagMenuItem isActive" : "catalogTagMenuItem"} type="button" role="menuitem" onClick={() => navigate(sortBy, sortOrder, "")}>
                {!tag ? <Check size={14} aria-hidden="true" /> : <span className="catalogMenuSpacer" />}
                <span>{uiText(locale, "不限标签")}</span>
              </button>
              {quickTags.map((item) => (
                <button className={tag === item.slug ? "catalogTagMenuItem isActive" : "catalogTagMenuItem"} type="button" role="menuitem" onClick={() => navigate(sortBy, sortOrder, item.slug)} key={item.id}>
                  {tag === item.slug ? <Check size={14} aria-hidden="true" /> : <span className="catalogMenuSpacer" />}
                  <span className="contentTag">#{item.name}</span>
                  <small>{item.videoCount}</small>
                </button>
              ))}
              <button className="catalogTagMenuAll" type="button" role="menuitem" onClick={() => {
                setOpenPanel(null);
                beginNavigationProgress();
                router.push(withLocalePath("/media/tags", locale));
              }}>
                <Tags size={14} aria-hidden="true" />
                <span>{uiText(locale, "全部标签")}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
