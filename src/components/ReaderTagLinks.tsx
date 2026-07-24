"use client";

import { ChevronDown, ChevronUp, Tags } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TagTrackedLink } from "./TagTrackedLink";

type ReaderTag = {
  id: number;
  name: string;
  slug: string;
};

export function ReaderTagLinks({ tags }: { tags: ReaderTag[] }) {
  const [expanded, setExpanded] = useState(false);
  const [hasMoreThanTwoRows, setHasMoreThanTwoRows] = useState(false);
  const linksRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const links = linksRef.current;
    if (!links) return;

    function measureRows() {
      const containerTop = links!.getBoundingClientRect().top;
      const rows: Array<{ top: number; bottom: number }> = [];
      for (const link of links!.querySelectorAll<HTMLAnchorElement>("a")) {
        const bounds = link.getBoundingClientRect();
        const row = rows.find((item) => Math.abs(item.top - bounds.top) < 2);
        if (row) {
          row.bottom = Math.max(row.bottom, bounds.bottom);
        } else {
          rows.push({ top: bounds.top, bottom: bounds.bottom });
        }
      }
      if (rows[1]) {
        links!.style.setProperty("--reader-tags-collapsed-height", `${Math.ceil(rows[1].bottom - containerTop + 2)}px`);
      } else {
        links!.style.removeProperty("--reader-tags-collapsed-height");
      }
      setHasMoreThanTwoRows(rows.length > 2);
    }

    measureRows();
    const resizeObserver = new ResizeObserver(measureRows);
    resizeObserver.observe(links);
    const preferenceObserver = new MutationObserver(measureRows);
    preferenceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-mode", "data-reader-tags"] });
    return () => {
      resizeObserver.disconnect();
      preferenceObserver.disconnect();
    };
  }, [tags]);

  if (!tags.length) {
    return null;
  }

  return (
    <div className={`readerTagsBlock${expanded ? " isExpanded" : ""}${hasMoreThanTwoRows ? " hasOverflow" : ""}`}>
      <button
        className="readerTagsCountToggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Tags size={17} aria-hidden="true" />
        <span>{tags.length} 个标签</span>
        {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      <nav className="readerTagLinks" aria-label="文章标签" ref={linksRef}>
        {tags.map((tag) => (
          <TagTrackedLink slug={tag.slug} key={tag.id}>
            {tag.name}
          </TagTrackedLink>
        ))}
      </nav>
      {hasMoreThanTwoRows ? (
        <button
          className="readerTagsInlineToggle"
          type="button"
          aria-label={expanded ? "收起文章标签" : "展开文章标签"}
          title={expanded ? "收起" : "展开"}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
        </button>
      ) : null}
    </div>
  );
}
