"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type {
  NovelCatalogSort as NovelCatalogSortValue,
  NovelCatalogSortOrder,
} from "@/lib/books";
import { uiText, type AppLocale } from "@/lib/locale";

const SORT_OPTIONS: Array<{ value: NovelCatalogSortValue; label: "时间" | "名称" | "字数" }> = [
  { value: "updated", label: "时间" },
  { value: "name", label: "名称" },
  { value: "words", label: "字数" },
];

function defaultOrder(value: NovelCatalogSortValue): NovelCatalogSortOrder {
  return value === "name" ? "asc" : "desc";
}

export function NovelCatalogSort({
  sortBy,
  sortOrder,
  locale,
}: {
  sortBy: NovelCatalogSortValue;
  sortOrder: NovelCatalogSortOrder;
  locale: AppLocale;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);
  const tr = (text: string) => uiText(locale, text);
  const activeLabel = tr(SORT_OPTIONS.find((option) => option.value === sortBy)?.label || "时间");
  const directionLabel = tr(sortOrder === "asc" ? "升序" : "降序");

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) setOpen(false);
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

  function sortHref(value: NovelCatalogSortValue): string {
    const params = new URLSearchParams(searchParams.toString());
    const nextOrder = sortBy === value
      ? sortOrder === "asc" ? "desc" : "asc"
      : defaultOrder(value);
    if (value === "updated") params.delete("sort");
    else params.set("sort", value);
    if (nextOrder === defaultOrder(value)) params.delete("order");
    else params.set("order", nextOrder);
    params.delete("page");
    params.delete("random");
    return `${pathname}${params.size ? `?${params.toString()}` : ""}`;
  }

  return (
    <div className="catalogMenuControl novelSortControl" ref={sortRef}>
      <button
        className={"catalogMenuTrigger" + (sortBy !== "updated" || sortOrder !== "desc" ? " isActive" : "")}
        type="button"
        aria-label={`${tr("排序")}：${activeLabel}，${directionLabel}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`${tr("排序")}：${activeLabel}，${directionLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <ArrowUpDown size={16} aria-hidden="true" />
      </button>
      {open ? (
        <div className="catalogMenuPopover catalogSortPopover" role="menu" aria-label={tr("小说排序")}>
          {SORT_OPTIONS.map(({ value, label }) => {
            const active = sortBy === value;
            const itemOrder = active ? sortOrder : defaultOrder(value);
            return (
              <Link
                className={active ? "catalogMenuItem isActive" : "catalogMenuItem"}
                href={sortHref(value)}
                role="menuitem"
                title={active ? tr(itemOrder === "asc" ? "切换为降序" : "切换为升序") : undefined}
                onClick={() => setOpen(false)}
                key={value}
              >
                <span>{tr(label)}</span>
                {active ? itemOrder === "asc"
                  ? <ArrowUp size={14} aria-hidden="true" />
                  : <ArrowDown size={14} aria-hidden="true" />
                : null}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
