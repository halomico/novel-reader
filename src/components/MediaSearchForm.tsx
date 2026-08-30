"use client";

import { Search, X } from "lucide-react";
import Form from "next/form";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { beginNavigationProgress } from "./NavigationProgress";

type HiddenField = {
  name: string;
  value: string;
};

export function MediaSearchForm({
  action = "/media",
  query = "",
  placeholder,
  clearHref,
  clearLabel = "清除搜索",
  submitLabel = "搜索资源",
  hiddenFields = [],
  className = "mediaSearchForm tagLibrarySearch",
}: {
  action?: string;
  query?: string;
  placeholder: string;
  clearHref: string;
  clearLabel?: string;
  submitLabel?: string;
  hiddenFields?: HiddenField[];
  className?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [keyword, setKeyword] = useState(query);

  useEffect(() => {
    setKeyword(query);
  }, [query]);

  return (
    <Form className={className} action={action} role="search" onSubmit={beginNavigationProgress}>
      <Search size={16} aria-hidden="true" />
      <input
        ref={inputRef}
        name="q"
        type="search"
        value={keyword}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setKeyword(event.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      {hiddenFields.map((field) => (
        <input key={`${field.name}-${field.value}`} name={field.name} type="hidden" value={field.value} />
      ))}
      {keyword.trim() ? (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setKeyword("");
            if (query.trim()) {
              beginNavigationProgress();
              router.push(clearHref);
              return;
            }
            window.requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : null}
      <button className="searchSubmit isVisuallyHidden" type="submit" tabIndex={-1} aria-label={submitLabel}>
        {submitLabel}
      </button>
    </Form>
  );
}
