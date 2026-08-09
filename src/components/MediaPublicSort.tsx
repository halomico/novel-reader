"use client";

import { ArrowDown, ArrowUp, Check, ListFilter, Tags } from "lucide-react";
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

  const quickTags = tags.slice(0, TAG_RESULT_LIMIT);

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

  function navigate(nextSort: MediaSortBy, nextOrder: MediaSortOrder, nextTag = tag || "") {
    const defaultSort: MediaSortBy = kind === "video" ? "published" : kind === "audio" && !folder ? "duration" : "name";
    const params = new URLSearchParams({ kind });
    if (folder) params.set("folder", folder);
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    if (kind === "video" && nextTag) params.set("tag", nextTag);
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
    <div className="mediaBrowseMenu" ref={containerRef}>
      <button
        className={open ? "mediaSortTrigger isOpen" : "mediaSortTrigger"}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={uiText(locale, "筛选与排序")}
        title={uiText(locale, "筛选与排序")}
        onClick={() => setOpen((value) => !value)}
      >
        <ListFilter size={17} aria-hidden="true" />
      </button>
      {open ? (
        <div className={kind === "video" ? "mediaBrowsePopover" : "mediaBrowsePopover isCompact"} role="dialog" aria-label={uiText(locale, "筛选与排序")}>
          <section className="mediaBrowseSection">
            <strong>{uiText(locale, "排序")}</strong>
            <div className="mediaBrowseOptions">
              {options.map((option) => {
                const active = option.value === sortBy;
                return (
                  <button className={active ? "isActive" : ""} type="button" onClick={() => selectSort(option.value)} key={option.value}>
                    {active ? sortOrder === "asc" ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" /> : <span />}
                    {option.label}
                  </button>
                );
              })}
            </div>
          </section>
          {kind === "video" ? (
            <section className="mediaBrowseSection isTags">
              <header>
                <strong>{uiText(locale, "标签")}</strong>
                <button type="button" onClick={() => {
                  setOpen(false);
                  beginNavigationProgress();
                  router.push(withLocalePath("/media/tags", locale));
                }}>
                  <Tags size={14} aria-hidden="true" />{uiText(locale, "全部标签")}
                </button>
              </header>
              <div className="mediaBrowseTagOptions">
                <button className={!tag ? "isActive" : ""} type="button" onClick={() => navigate(sortBy, sortOrder, "")}>
                  {!tag ? <Check size={14} aria-hidden="true" /> : <span />}{uiText(locale, "不限标签")}
                </button>
                {quickTags.map((item) => (
                  <button className={tag === item.slug ? "isActive" : ""} type="button" onClick={() => navigate(sortBy, sortOrder, item.slug)} key={item.id}>
                    {tag === item.slug ? <Check size={14} aria-hidden="true" /> : <span />}
                    <span className="contentTag">#{item.name}</span><small>{item.videoCount}</small>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
