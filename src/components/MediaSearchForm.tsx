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
  className = "mediaSearchForm",
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
      <input
        ref={inputRef}
        name="q"
        type="search"
        value={keyword}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(event) => setKeyword(event.target.value)}
        autoComplete="off"
      />
      {hiddenFields.map((field) => (
        <input key={`${field.name}-${field.value}`} name={field.name} type="hidden" value={field.value} />
      ))}
      <div className="mediaSearchTrailing">
        {keyword.trim() ? (
          <button
            className="mediaSearchIconButton mediaSearchClearButton"
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
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : null}
        <button className="mediaSearchIconButton mediaSearchSubmitButton" type="submit" aria-label={submitLabel} title={submitLabel}>
          <Search size={15} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
    </Form>
  );
}
