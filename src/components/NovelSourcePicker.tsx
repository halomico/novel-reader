"use client";

import { Check, ListFilter } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { NovelAccessFilter } from "@/lib/books";
import { uiText, type AppLocale } from "@/lib/locale";
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
  access,
  locale,
  rememberForUserId,
}: {
  sources: NovelSource[];
  activeSlug: string;
  access: NovelAccessFilter;
  locale: AppLocale;
  rememberForUserId?: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const tr = (text: string) => uiText(locale, text);
  const activeSource = sources.find((source) => source.slug === activeSlug);
  const activeLabel = activeSlug === ALL_NOVEL_LIBRARIES_SLUG
    ? tr("全部")
    : activeSource ? novelLibraryDisplayName(activeSource) : tr("默认");
  const accessLabel = access === "free" ? tr("免费") : access === "soda" ? tr("苏打") : tr("全部");

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

  function accessHref(value: NovelAccessFilter): string {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete("access");
    else params.set("access", value);
    params.delete("page");
    params.delete("random");
    return `${pathname}${params.size ? `?${params.toString()}` : ""}`;
  }

  return (
    <div className="catalogMenuControl novelFilterControl" ref={pickerRef}>
      <button
        className={"catalogMenuTrigger" + (activeSlug !== DEFAULT_NOVEL_LIBRARY_SLUG || access !== "all" ? " isActive" : "")}
        type="button"
        aria-label={`${tr("筛选")}：${activeLabel} · ${accessLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${tr("筛选")}：${activeLabel} · ${accessLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <ListFilter size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="catalogMenuPopover catalogFilterPopover" role="menu" aria-label={tr("筛选小说")}>
          <span className="novelFilterSectionLabel" role="presentation">{tr("来源")}</span>
          {sources.map((source) => (
            <Link
              className={source.slug === activeSlug ? "catalogMenuItem isActive" : "catalogMenuItem"}
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
            className={activeSlug === ALL_NOVEL_LIBRARIES_SLUG ? "catalogMenuItem isActive isAllLibraries" : "catalogMenuItem isAllLibraries"}
            href={sourceHref(ALL_NOVEL_LIBRARIES_SLUG)}
            role="menuitem"
            onClick={() => {
              rememberSource(ALL_NOVEL_LIBRARIES_SLUG);
              setOpen(false);
            }}
          >
            <span>{tr("全部")}</span>
            {activeSlug === ALL_NOVEL_LIBRARIES_SLUG ? <Check size={14} aria-hidden="true" /> : null}
          </Link>
          <span className="novelFilterSectionLabel" role="presentation">{tr("内容")}</span>
          {(["all", "free", "soda"] as const).map((value) => {
            const label = value === "free" ? tr("免费") : value === "soda" ? tr("苏打") : tr("全部");
            return (
              <Link
                className={access === value ? "catalogMenuItem isActive" : "catalogMenuItem"}
                href={accessHref(value)}
                role="menuitem"
                onClick={() => setOpen(false)}
                key={value}
              >
                <span>{label}</span>
                {access === value ? <Check size={14} aria-hidden="true" /> : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
