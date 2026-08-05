"use client";

import { Search } from "lucide-react";
import Form from "next/form";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
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
        onChange={(event) => setKeyword(event.target.value)}
      />
      <input name="kind" type="hidden" value={kind} />
      <button className="searchSubmit" type="submit" aria-label={label} title={label}>
        <Search className="searchSubmitIcon" size={16} aria-hidden="true" />
        <span>{uiText(locale, "搜索")}</span>
      </button>
    </Form>
  );
}
