"use client";

import { Search, X } from "lucide-react";
import Form from "next/form";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { localeFromPathname, uiText, withLocalePath } from "@/lib/locale";
import type { MediaKind } from "@/lib/media";
import { beginNavigationProgress } from "./NavigationProgress";

const SEARCH_LABELS: Record<MediaKind, string> = {
  video: "搜索视频",
  audio: "搜索音频",
  file: "搜索文件",
};

export function HeaderMediaSearch({ kind, query = "" }: { kind: MediaKind; query?: string }) {
  const pathname = usePathname();
  const locale = localeFromPathname(pathname);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState(query);
  const [expanded, setExpanded] = useState(Boolean(query.trim()));
  const label = uiText(locale, SEARCH_LABELS[kind]);

  useEffect(() => {
    setKeyword(query);
    if (query.trim()) setExpanded(true);
  }, [query]);

  return (
    <Form
      className={expanded ? "searchForm headerMediaSearch isPinnedOpen" : "searchForm headerMediaSearch"}
      action={withLocalePath("/media", locale)}
      role="search"
      onSubmit={beginNavigationProgress}
    >
      <button
        className="searchIconButton"
        type="button"
        aria-label={uiText(locale, expanded ? "收起搜索框" : "展开搜索框")}
        aria-controls={inputId}
        aria-expanded={expanded}
        title={uiText(locale, expanded ? "收起搜索框" : "展开搜索框")}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          const nextExpanded = !expanded;
          setExpanded(nextExpanded);
          if (nextExpanded) window.requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Search size={20} aria-hidden="true" />
      </button>
      <input
        id={inputId}
        ref={inputRef}
        name="q"
        type="search"
        value={keyword}
        placeholder={label}
        aria-label={label}
        autoComplete="off"
        onChange={(event) => setKeyword(event.target.value)}
      />
      <input name="kind" type="hidden" value={kind} />
      <div className="searchTrailing">
        {keyword.trim() ? (
          <button
            className="searchClearButton"
            type="button"
            aria-label={uiText(locale, "清除搜索")}
            title={uiText(locale, "清除搜索")}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setKeyword("");
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
        <button className="searchSubmit" type="submit" aria-label={label} title={label}>
          <Search className="searchSubmitIcon" size={16} strokeWidth={1.85} aria-hidden="true" />
        </button>
      </div>
    </Form>
  );
}
