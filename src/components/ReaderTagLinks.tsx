"use client";

import { ChevronDown, ChevronUp, Tags } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

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
      const rowTops: number[] = [];
      for (const link of links!.querySelectorAll("a")) {
        const top = link.getBoundingClientRect().top;
        if (!rowTops.some((rowTop) => Math.abs(rowTop - top) < 2)) rowTops.push(top);
      }
      setHasMoreThanTwoRows(rowTops.length > 2);
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
          <Link href={`/tags/${tag.slug}`} key={tag.id}>
            {tag.name}
          </Link>
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
