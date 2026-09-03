"use client";

import { ArrowUpDown, Check, PenLine, Search, Tags, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "@/components/LocalizedLink";
import type { AppLocale } from "@/lib/locale";
import { uiText } from "@/lib/locale";
import type { OriginalSort } from "@/lib/original";

const SORT_OPTIONS: Array<{ value: OriginalSort; label: string }> = [
  { value: "latest", label: "最新" },
  { value: "popular", label: "最热" },
  { value: "name", label: "名称" },
];

function originalHref(options: { q?: string; tag?: string; sort?: OriginalSort }): string {
  const params = new URLSearchParams();
  if (options.q) params.set("q", options.q);
  if (options.tag) params.set("tag", options.tag);
  if (options.sort && options.sort !== "latest") params.set("sort", options.sort);
  return `/original${params.size ? `?${params.toString()}` : ""}`;
}

export function OriginalBrowseControls({
  q,
  tag,
  sort,
  locale,
  signedIn,
}: {
  q: string;
  tag: string;
  sort: OriginalSort;
  locale: AppLocale;
  signedIn: boolean;
}) {
  const tr = (text: string) => uiText(locale, text);
  const rootRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);
  const [menu, setMenu] = useState<"sort" | null>(null);
  const activeSort = SORT_OPTIONS.find((option) => option.value === sort) || SORT_OPTIONS[0];

  useEffect(() => setSearch(q), [q]);

  function submitSearch() {
    const params = new URLSearchParams();
    const normalized = search.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (normalized) params.set("q", normalized);
    if (tag) params.set("tag", tag);
    if (sort !== "latest") params.set("sort", sort);
    router.push(`${pathname || "/original"}${params.size ? `?${params.toString()}` : ""}`);
  }

  function clearSearch() {
    setSearch("");
    const params = new URLSearchParams();
    if (tag) params.set("tag", tag);
    if (sort !== "latest") params.set("sort", sort);
    router.replace(`${pathname || "/original"}${params.size ? `?${params.toString()}` : ""}`);
  }

  useEffect(() => {
    if (!menu) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(null);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenu(null);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menu]);

  return (
    <div className="originalBrowseControls" ref={rootRef}>
      <form
        className="tagLibrarySearch originalSearchForm"
        method="get"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <button className="originalSearchSubmit" type="submit" aria-label={tr("搜索") } onClick={(event) => { event.preventDefault(); submitSearch(); }}>
          <Search size={15} aria-hidden="true" />
        </button>
        <input name="q" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitSearch(); } }} placeholder={tr("搜索文章")} maxLength={80} aria-label={tr("搜索原创文章")} />
        {search ? (
          <button className="originalSearchClear" type="button" aria-label={tr("清空搜索")} title={tr("清空搜索")} onClick={clearSearch}>
            <X size={14} aria-hidden="true" />
          </button>
        ) : null}
        {tag ? <input type="hidden" name="tag" value={tag} /> : null}
        {sort !== "latest" ? <input type="hidden" name="sort" value={sort} /> : null}
      </form>

      <div className="catalogMenuControl">
        <button
          className={`catalogMenuTrigger${menu === "sort" || sort !== "latest" ? " isActive" : ""}`}
          type="button"
          aria-expanded={menu === "sort"}
          aria-haspopup="menu"
          aria-label={`${tr("排序")}：${tr(activeSort.label)}`}
          title={`${tr("排序")}：${tr(activeSort.label)}`}
          onClick={() => setMenu((current) => current === "sort" ? null : "sort")}
        >
          <ArrowUpDown size={16} aria-hidden="true" />
        </button>
        {menu === "sort" ? (
          <div className="catalogMenuPopover originalSortPopover" role="menu" aria-label={tr("排序")}>
            {SORT_OPTIONS.map((option) => (
              <Link
                className={sort === option.value ? "catalogMenuItem isActive" : "catalogMenuItem"}
                href={originalHref({ q: search, tag, sort: option.value })}
                role="menuitem"
                onClick={() => setMenu(null)}
                key={option.value}
              >
                {sort === option.value ? <Check size={14} aria-hidden="true" /> : <i className="catalogMenuItemMarker" aria-hidden="true" />}
                <span>{tr(option.label)}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <Link
        className={`catalogMenuTrigger originalTagDirectoryLink${tag ? " isActive" : ""}`}
        href="/original/tags"
        aria-label={tr("标签")}
        title={tr("标签")}
      >
        <Tags size={16} aria-hidden="true" />
      </Link>

      <Link
        className="originalPublishLink"
        href={signedIn ? "/original/new" : "/login?returnTo=%2Foriginal%2Fnew"}
        aria-label={tr("发布文章")}
      >
        <PenLine size={15} aria-hidden="true" />
        <span>{tr("发布文章")}</span>
      </Link>
    </div>
  );
}
