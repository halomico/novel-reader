"use client";

import { ChevronDown, ChevronUp, Tags } from "lucide-react";
import { useState } from "react";
import { TagTrackedLink } from "./TagTrackedLink";

type ReaderTag = {
  id: number;
  name: string;
  slug: string;
};

export function ReaderTagLinks({ tags }: { tags: ReaderTag[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = tags.length > 8;

  if (!tags.length) {
    return null;
  }

  return (
    <div className={`readerTagsBlock${expanded ? " isExpanded" : ""}${collapsible ? " hasOverflow" : ""}`}>
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
      <nav className="readerTagLinks" aria-label="文章标签">
        {tags.map((tag) => (
          <TagTrackedLink slug={tag.slug} key={tag.id}>
            {tag.name}
          </TagTrackedLink>
        ))}
      </nav>
      {collapsible ? (
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
