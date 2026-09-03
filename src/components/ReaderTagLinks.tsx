"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { TagTrackedLink } from "./TagTrackedLink";

type ReaderTag = {
  id: number;
  name: string;
  slug: string;
};

export function ReaderTagLinks({ tags, library = "default" }: { tags: ReaderTag[]; library?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [layout, setLayout] = useState({ measured: false, collapsible: false, visibleCount: tags.length });
  const linksRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const links = linksRef.current;
    const measure = measureRef.current;
    if (!links || !measure) return;
    let cancelled = false;

    function measureRows() {
      if (cancelled || !links || !measure) return;
      const available = links.clientWidth;
      const items = Array.from(measure.querySelectorAll<HTMLElement>("[data-reader-tag-measure]"));
      const toggle = measure.querySelector<HTMLElement>("[data-reader-toggle-measure]");
      if (!available || !items.length || !toggle) return;
      const gap = Number.parseFloat(getComputedStyle(links).columnGap) || 0;
      const rows: Array<{ start: number; end: number; used: number }> = [];
      let rowStart = 0;
      let rowUsed = 0;

      items.forEach((item, index) => {
        const width = item.getBoundingClientRect().width;
        const nextWidth = rowUsed ? rowUsed + gap + width : width;
        if (rowUsed && nextWidth > available + 0.5) {
          rows.push({ start: rowStart, end: index, used: rowUsed });
          rowStart = index;
          rowUsed = width;
        } else {
          rowUsed = nextWidth;
        }
      });
      rows.push({ start: rowStart, end: items.length, used: rowUsed });

      if (rows.length <= 2) {
        setLayout({ measured: true, collapsible: false, visibleCount: tags.length });
        return;
      }

      const secondRow = rows[1];
      let visibleCount = secondRow.end;
      let used = secondRow.used;
      const toggleWidth = toggle.getBoundingClientRect().width;
      while (visibleCount > secondRow.start && used + gap + toggleWidth > available + 0.5) {
        const removedWidth = items[visibleCount - 1].getBoundingClientRect().width;
        visibleCount -= 1;
        used -= removedWidth + (visibleCount > secondRow.start ? gap : 0);
      }
      setLayout({ measured: true, collapsible: true, visibleCount });
    }

    const observer = new ResizeObserver(measureRows);
    observer.observe(links);
    measureRows();
    void document.fonts?.ready.then(measureRows);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [tags]);

  if (!tags.length) {
    return null;
  }

  return (
    <div className={`readerTagsBlock${expanded ? " isExpanded" : ""}${layout.collapsible ? " hasOverflow" : ""}${layout.measured ? " isMeasured" : ""}`}>
      <nav className="readerTagLinks" aria-label="文章标签" ref={linksRef}>
        {tags.map((tag, index) => (
          <TagTrackedLink
            className={`tagChip contentTagLink${index >= layout.visibleCount ? " readerTagOverflowItem" : ""}`}
            slug={tag.slug}
            library={library}
            key={tag.id}
          >
            {tag.name}
          </TagTrackedLink>
        ))}
        {layout.collapsible ? (
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
      </nav>
      <div className="readerTagMeasure" ref={measureRef} aria-hidden="true">
        {tags.map((tag) => <span className="tagChip contentTagLink" data-reader-tag-measure key={tag.id}>{tag.name}</span>)}
        <span className="readerTagsInlineToggle" data-reader-toggle-measure><ChevronDown size={18} aria-hidden="true" /></span>
      </div>
    </div>
  );
}
