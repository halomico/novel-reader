"use client";

import { Check, ListFilter } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  ALL_NOVEL_LIBRARIES_SLUG,
  DEFAULT_NOVEL_LIBRARY_SLUG,
  novelLibraryDisplayName,
  novelLibraryPreferenceCookieName,
} from "@/lib/novel-library-scope";
import type { NovelSource } from "@/lib/novel-library";

export function NovelSourcePicker({
  sources,
  activeSlug,
  rememberForUserId,
}: {
  sources: NovelSource[];
  activeSlug: string;
  rememberForUserId?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const activeSource = sources.find((source) => source.slug === activeSlug);
  const activeLabel = activeSlug === ALL_NOVEL_LIBRARIES_SLUG
    ? "全部"
    : activeSource ? novelLibraryDisplayName(activeSource) : "默认";

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function sourceHref(slug: string): string {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("sourceLibrary");
    if (slug && slug !== DEFAULT_NOVEL_LIBRARY_SLUG) params.set("library", slug);
    else params.delete("library");
    params.delete("page");
    params.delete("random");
    return `${pathname}${params.size ? `?${params.toString()}` : ""}`;
  }

  function rememberSource(slug: string) {
    if (!rememberForUserId) return;
    document.cookie = `${novelLibraryPreferenceCookieName(rememberForUserId)}=${slug}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  return (
    <div className="novelSourceFilter" ref={pickerRef}>
      <button
        className="novelSourceFilterButton"
        type="button"
        aria-label={`当前书库：${activeLabel}，点击更换`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`当前书库：${activeLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <ListFilter size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="novelSourceFilterMenu" role="menu" aria-label="选择书库">
          {sources.map((source) => (
            <Link
              className={source.slug === activeSlug ? "isActive" : ""}
              href={sourceHref(source.slug)}
              role="menuitem"
              onClick={() => {
                rememberSource(source.slug);
                setOpen(false);
              }}
              key={source.id}
            >
              <span>{novelLibraryDisplayName(source)}</span>
              <small>{source.novelCount}</small>
              {source.slug === activeSlug ? <Check size={14} aria-hidden="true" /> : null}
            </Link>
          ))}
          <Link
            className={activeSlug === ALL_NOVEL_LIBRARIES_SLUG ? "isActive isAllLibraries" : "isAllLibraries"}
            href={sourceHref(ALL_NOVEL_LIBRARIES_SLUG)}
            role="menuitem"
            onClick={() => {
              rememberSource(ALL_NOVEL_LIBRARIES_SLUG);
              setOpen(false);
            }}
          >
            <span>全部</span>
            {activeSlug === ALL_NOVEL_LIBRARIES_SLUG ? <Check size={14} aria-hidden="true" /> : null}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
