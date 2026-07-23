"use client";

import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpNarrowWide,
  CalendarDays,
  Check,
  Clock,
  HardDrive,
  Play,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MediaSortBy, MediaSortOrder } from "@/lib/media";

export type MediaSortOption = {
  value: MediaSortBy;
  label: string;
};

const OPTION_ICONS: Record<MediaSortBy, LucideIcon> = {
  name: ArrowUpDown,
  duration: Clock,
  size: HardDrive,
  plays: Play,
  updated: CalendarDays,
};

export function MediaSortMenu({
  options,
  sortBy,
  sortOrder,
  onChange,
}: {
  options: MediaSortOption[];
  sortBy: MediaSortBy;
  sortOrder: MediaSortOrder;
  onChange: (sortBy: MediaSortBy, sortOrder: MediaSortOrder) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const activeOption = options.find((option) => option.value === sortBy) || options[0];
  const SortIcon = sortOrder === "asc" ? ArrowUpNarrowWide : ArrowDownWideNarrow;

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

  function select(nextSortBy: MediaSortBy) {
    const nextOrder = nextSortBy === sortBy
      ? sortOrder === "asc" ? "desc" : "asc"
      : nextSortBy === "name" ? "asc" : "desc";
    setOpen(false);
    onChange(nextSortBy, nextOrder);
  }

  const currentLabel = `${activeOption.label}，${sortOrder === "asc" ? "升序" : "降序"}`;

  return (
    <div className="mediaSortMenu" ref={containerRef}>
      <button
        className={open ? "mediaSortTrigger isOpen" : "mediaSortTrigger"}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`排序：${currentLabel}`}
        title={`排序：${currentLabel}`}
        onClick={() => setOpen((value) => !value)}
      >
        <SortIcon size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div className="mediaSortPopover" role="menu" aria-label="资源排序方式">
          {options.map((option) => {
            const Icon = OPTION_ICONS[option.value];
            const active = option.value === sortBy;
            return (
              <button
                className={active ? "isActive" : ""}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => select(option.value)}
                key={option.value}
              >
                <Icon size={15} aria-hidden="true" />
                <span>{option.label}</span>
                {active ? <Check size={14} aria-hidden="true" /> : <span className="mediaSortMenuSpacer" />}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
