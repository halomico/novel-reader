"use client";

import { Search, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
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

export function TagLibrarySearch({ locale, initialQuery = "", targetId = "tag-library" }: { locale: AppLocale; initialQuery?: string; targetId?: string }) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The search control lives in the context bar, outside the tag list. Keep
    // the target explicit instead of relying on a sibling/ancestor relationship.
    const root = document.getElementById(targetId);
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
  }, [query, targetId]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    syncUrl(query);
  }

  function syncUrl(value: string) {
    const url = new URL(window.location.href);
    const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    if (normalized) url.searchParams.set("q", normalized);
    else url.searchParams.delete("q");
    // Persist the filter without a document navigation or a database request.
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }

  return (
    <form className="tagLibrarySearch" role="search" onSubmit={submit}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            syncUrl(query);
          }
        }}
        placeholder={uiText(locale, "搜索标签")}
        aria-label={uiText(locale, "搜索标签")}
        aria-controls={targetId}
        autoComplete="off"
        spellCheck={false}
      />
      {query ? (
        <button
          type="button"
          onClick={() => {
            setQuery("");
            syncUrl("");
          }}
          aria-label={uiText(locale, "清空搜索")}
          title={uiText(locale, "清空")}
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button className="srOnly" type="submit" tabIndex={-1}>{uiText(locale, "搜索")}</button>
    </form>
  );
}
