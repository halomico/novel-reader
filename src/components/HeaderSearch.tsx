"use client";

import { Search } from "lucide-react";
import { useState } from "react";

type SearchMode = "title" | "content";

const options: Array<{ value: SearchMode; label: string; action: string }> = [
  { value: "title", label: "书名", action: "/" },
  { value: "content", label: "正文", action: "/search" },
];

export function HeaderSearch({
  query = "",
  defaultMode = "title",
}: {
  query?: string;
  defaultMode?: SearchMode;
}) {
  const [mode, setMode] = useState<SearchMode>(defaultMode);
  const [isOpen, setIsOpen] = useState(false);
  const activeOption = options.find((option) => option.value === mode) || options[0];

  return (
    <form
      className="searchForm"
      action={activeOption.action}
      role="search"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setIsOpen(false);
        }
      }}
    >
      <Search size={18} aria-hidden="true" />
      <input
        name="q"
        type="search"
        defaultValue={query}
        placeholder={mode === "content" ? "搜索全部小说正文" : "搜索小说名"}
        aria-label={mode === "content" ? "搜索全部小说正文" : "搜索小说名"}
        onFocus={() => setIsOpen(true)}
        onClick={() => setIsOpen(true)}
      />
      <button className="searchSubmit" type="submit" aria-label={`按${activeOption.label}搜索`} title={`按${activeOption.label}搜索`}>
        搜索
      </button>
      {isOpen ? (
        <div className="searchModeMenu" role="group" aria-label="搜索范围">
          {options.map((option) => (
            <button
              className={mode === option.value ? "isActive" : ""}
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
