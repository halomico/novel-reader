"use client";

import { Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { uiText, type AppLocale } from "@/lib/locale";

function normalizedTerms(value: string): string[] {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
}

function matchesTerms(value: string | undefined, terms: string[]): boolean {
  const haystack = (value || "").normalize("NFKC").toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function TagLibrarySearch({ locale }: { locale: AppLocale }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const root = inputRef.current?.closest<HTMLElement>(".tagLibrary");
    if (!root) return;
    const terms = normalizedTerms(query);
    const groups = Array.from(root.querySelectorAll<HTMLElement>("[data-tag-group-search]"));
    let visibleGroups = 0;

    for (const group of groups) {
      const groupMatches = terms.length > 0 &&
        matchesTerms(group.dataset.tagGroupSearch, terms);
      const tags = Array.from(group.querySelectorAll<HTMLElement>("[data-tag-search]"));
      let visibleTags = 0;
      for (const tag of tags) {
        const visible = terms.length === 0 || groupMatches ||
          matchesTerms(tag.dataset.tagSearch, terms);
        tag.hidden = !visible;
        if (visible) visibleTags += 1;
      }
      const visible = terms.length === 0 || groupMatches || visibleTags > 0;
      group.hidden = !visible;
      if (visible) visibleGroups += 1;
    }

    const empty = root.querySelector<HTMLElement>(".tagLibraryFilterEmpty");
    if (empty) {
      empty.hidden = terms.length === 0 || visibleGroups > 0;
    }
  }, [query]);

  return (
    <div className="tagLibrarySearch" role="search">
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={uiText(locale, "搜索标签")}
        aria-label={uiText(locale, "搜索标签")}
        aria-controls="tag-library-groups"
        autoComplete="off"
        spellCheck={false}
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          aria-label={uiText(locale, "清空搜索")}
          title={uiText(locale, "清空")}
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
