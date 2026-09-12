"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, PenLine, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "@/components/LocalizedLink";
import type { AppLocale } from "@/lib/locale";
import { uiText } from "@/lib/locale";
import {
  defaultOriginalSortOrder,
  type OriginalSort,
  type OriginalSortOrder,
} from "@/domains/originals/original-model";

const SORT_OPTIONS: Array<{ value: OriginalSort; label: string }> = [
  { value: "latest", label: "最新" },
  { value: "popular", label: "最热" },
  { value: "name", label: "名称" },
];

export function OriginalBrowseControls({
  q,
  tag,
  sort,
  order,
  locale,
}: {
  q: string;
  tag: string;
  sort: OriginalSort;
  order: OriginalSortOrder;
  locale: AppLocale;
}) {
  const tr = (text: string) => uiText(locale, text);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState(q);
  const [expanded, setExpanded] = useState(() => Boolean(q));
  const [menu, setMenu] = useState<"sort" | null>(null);
  const activeSortLabel = tr(SORT_OPTIONS.find((option) => option.value === sort)?.label || "最新");
  const directionLabel = tr(order === "asc" ? "升序" : "降序");
  const sortActive = sort !== "latest" || order !== defaultOriginalSortOrder(sort);

  useEffect(() => {
    setSearch(q);
    if (q) setExpanded(true);
  }, [q]);

  function hrefFor(next: { q?: string; sort?: OriginalSort; order?: OriginalSortOrder } = {}): string {
    const params = new URLSearchParams();
    const query = (next.q ?? search).normalize("NFKC").replace(/\s+/gu, " ").trim();
    const nextSort = next.sort ?? sort;
    const nextOrder = next.order ?? (next.sort && next.sort !== sort ? defaultOriginalSortOrder(next.sort) : order);
    if (query) params.set("q", query);
    if (tag && !pathname.includes("/original/tags/")) params.set("tag", tag);
    if (nextSort !== "latest") params.set("sort", nextSort);
    if (nextOrder !== defaultOriginalSortOrder(nextSort)) params.set("order", nextOrder);
    return `${pathname || "/original"}${params.size ? `?${params.toString()}` : ""}`;
  }

  function submitSearch() {
    const normalized = search.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (!normalized) setExpanded(false);
    router.push(hrefFor({ q: normalized }));
  }

  function clearSearch() {
    setSearch("");
    setExpanded(false);
    router.replace(hrefFor({ q: "" }));
  }

  function toggleSearch() {
    setExpanded((current) => {
      const next = !current;
      if (next) queueMicrotask(() => inputRef.current?.focus());
      return next;
    });
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
        className={`originalSearchForm${expanded ? " tagLibrarySearch isExpanded" : " isCollapsed"}`}
        method="get"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          submitSearch();
        }}
      >
        <button
          className="originalSearchToggle"
          type="button"
          aria-label={tr(expanded ? "收起搜索框" : "展开搜索框")}
          aria-expanded={expanded}
          title={tr(expanded ? "收起搜索框" : "展开搜索框")}
          onClick={toggleSearch}
        >
          <Search size={16} aria-hidden="true" />
        </button>
        {expanded ? (
          <>
            <input
              ref={inputRef}
              name="q"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onBlur={() => {
                if (!search.trim() && !q) setExpanded(false);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                if (search) setSearch("");
                if (!q) setExpanded(false);
                inputRef.current?.blur();
              }}
              placeholder={tr("搜索文章")}
              maxLength={80}
              aria-label={tr("搜索原创文章")}
              autoComplete="off"
              spellCheck={false}
            />
            {search ? (
              <button className="originalSearchClear" type="button" aria-label={tr("清空搜索")} title={tr("清空搜索")} onClick={clearSearch}>
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
            {tag && !pathname.includes("/original/tags/") ? <input type="hidden" name="tag" value={tag} /> : null}
            {sort !== "latest" ? <input type="hidden" name="sort" value={sort} /> : null}
            {order !== defaultOriginalSortOrder(sort) ? <input type="hidden" name="order" value={order} /> : null}
            <button className="srOnly" type="submit" tabIndex={-1}>{tr("搜索")}</button>
          </>
        ) : null}
      </form>
      <div className="catalogMenuControl">
        <button
          className={`catalogMenuTrigger originalFilterTrigger${menu === "sort" || sortActive ? " isActive" : ""}`}
          type="button"
          aria-expanded={menu === "sort"}
          aria-haspopup="menu"
          aria-label={`${tr("排序")}：${activeSortLabel}，${directionLabel}`}
          title={`${tr("排序")}：${activeSortLabel}，${directionLabel}`}
          onClick={() => setMenu((current) => current === "sort" ? null : "sort")}
        >
          <ArrowUpDown size={16} aria-hidden="true" />
        </button>
        {menu === "sort" ? (
          <div className="catalogMenuPopover catalogSortPopover originalSortPopover" role="menu" aria-label={tr("排序")}>
            {SORT_OPTIONS.map((option) => {
              const active = sort === option.value;
              const itemOrder = active ? order : defaultOriginalSortOrder(option.value);
              const nextOrder = active ? (order === "asc" ? "desc" : "asc") : defaultOriginalSortOrder(option.value);
              return (
                <Link
                  className={active ? "catalogMenuItem isActive" : "catalogMenuItem"}
                  href={hrefFor({ q: search, sort: option.value, order: nextOrder })}
                  role="menuitem"
                  title={active ? tr(itemOrder === "asc" ? "切换为降序" : "切换为升序") : undefined}
                  onClick={() => setMenu(null)}
                  key={option.value}
                >
                  {active
                    ? itemOrder === "asc"
                      ? <ArrowUp size={14} aria-hidden="true" />
                      : <ArrowDown size={14} aria-hidden="true" />
                    : <i className="catalogMenuItemMarker" aria-hidden="true" />}
                  <span>{tr(option.label)}</span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
      <Link className="uiButton isPrimary originalBrowsePublish" href="/original/new" aria-label={tr("发布文章")} title={tr("发布文章")}>
        <PenLine size={16} aria-hidden="true" />
        <span>{tr("发布")}</span>
      </Link>
    </div>
  );
}
