"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState, useTransition } from "react";

type PageItem = number | "ellipsis";

function pageHref(page: number, query: string, basePath: string, pageParam: string) {
  const params = new URLSearchParams();
  params.set(pageParam, String(page));
  if (query) {
    params.set("q", query);
  }
  return `${basePath}?${params.toString()}`;
}

function pageHrefWithParams(
  page: number,
  query: string,
  basePath: string,
  extraParams: Record<string, string | undefined>,
  pageParam: string,
) {
  const params = new URLSearchParams(pageHref(page, query, basePath, pageParam).split("?")[1]);
  for (const [key, value] of Object.entries(extraParams)) {
    if (value) {
      params.set(key, value);
    }
  }
  return `${basePath}?${params.toString()}`;
}

function getPageItems(page: number, totalPages: number): PageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: PageItem[] = [1];
  const start = page <= 3 ? 2 : page >= totalPages - 2 ? Math.max(2, totalPages - 4) : Math.max(2, page - 1);
  const end = page <= 3 ? Math.min(5, totalPages - 1) : page >= totalPages - 2 ? totalPages - 1 : Math.min(totalPages - 1, page + 2);

  if (start > 2) {
    items.push("ellipsis");
  }

  for (let item = start; item <= end; item += 1) {
    items.push(item);
  }

  if (end < totalPages - 1) {
    items.push("ellipsis");
  }

  items.push(totalPages);
  return items;
}

function PageJump({
  totalPages,
  query,
  basePath,
  extraParams,
  pageParam,
  index,
  onPageChange,
}: {
  totalPages: number;
  query: string;
  basePath: string;
  extraParams: Record<string, string | undefined>;
  pageParam: string;
  index: number;
  onPageChange?: (page: number) => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function isMobileLike() {
    return window.matchMedia("(max-width: 820px), (pointer: coarse)").matches;
  }

  useEffect(() => clearCloseTimer, []);

  function jump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericPage = Number(value);
    if (!Number.isFinite(numericPage)) {
      return;
    }
    const nextPage = Math.min(Math.max(Math.floor(numericPage), 1), totalPages);
    if (onPageChange) {
      onPageChange(nextPage);
      setIsOpen(false);
      setValue("");
      clearCloseTimer();
      return;
    }
    clearCloseTimer();
    const href = pageHrefWithParams(nextPage, query, basePath, extraParams, pageParam);
    startTransition(() => router.push(href));
    setIsOpen(false);
    setValue("");
  }

  return (
    <span
      className="pageJump"
      onFocus={clearCloseTimer}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          clearCloseTimer();
          if (isMobileLike()) {
            closeTimerRef.current = setTimeout(() => setIsOpen(false), 3000);
          } else {
            setIsOpen(false);
          }
        }
      }}
    >
      <button
        className="pageEllipsis"
        type="button"
        aria-expanded={isOpen}
        aria-controls={`page-jump-${pageParam}-${index}`}
        aria-label="输入页码跳转"
        onClick={() => setIsOpen((current) => !current)}
      >
        ...
      </button>
      {isOpen ? (
        <form className="pageJumpPanel" id={`page-jump-${pageParam}-${index}`} onSubmit={jump}>
          <input
            autoFocus
            inputMode="numeric"
            min="1"
            max={totalPages}
            name="page"
            placeholder="页码"
            type="number"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" disabled={isPending}>跳转</button>
        </form>
      ) : null}
    </span>
  );
}

export function Pagination({
  page,
  totalPages,
  query,
  basePath = "/",
  extraParams = {},
  pageParam = "page",
  onPageChange,
}: {
  page: number;
  totalPages: number;
  query: string;
  basePath?: string;
  extraParams?: Record<string, string | undefined>;
  pageParam?: string;
  onPageChange?: (page: number) => void;
}) {
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;
  const pageItems = getPageItems(page, totalPages);

  if (totalPages <= 1) {
    return null;
  }

  return (
    <nav className="pagination" aria-label="分页导航">
      {canGoPrev ? (
        onPageChange ? (
          <button className="pageButton" type="button" onClick={() => onPageChange(page - 1)} aria-label="上一页">
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
        ) : (
          <Link className="pageButton" href={pageHrefWithParams(page - 1, query, basePath, extraParams, pageParam)} aria-label="上一页">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
        )
      ) : (
        <span className="pageButton isDisabled" aria-hidden="true">
          <ChevronLeft size={18} />
        </span>
      )}

      <div className="pageList" aria-label={`第 ${page} 页，共 ${totalPages} 页`}>
        {pageItems.map((item, index) =>
          item === "ellipsis" ? (
            <PageJump
              totalPages={totalPages}
              query={query}
              basePath={basePath}
              extraParams={extraParams}
              pageParam={pageParam}
              index={index}
              onPageChange={onPageChange}
              key={`ellipsis-${index}`}
            />
          ) : item === page ? (
            <span className="pageNumber isActive" aria-current="page" key={item}>
              {item}
            </span>
          ) : onPageChange ? (
            <button className="pageNumber" type="button" key={item} onClick={() => onPageChange(item)} aria-label={`第 ${item} 页`}>
              {item}
            </button>
          ) : (
            <Link className="pageNumber" href={pageHrefWithParams(item, query, basePath, extraParams, pageParam)} key={item} aria-label={`第 ${item} 页`}>
              {item}
            </Link>
          ),
        )}
      </div>

      {canGoNext ? (
        onPageChange ? (
          <button className="pageButton" type="button" onClick={() => onPageChange(page + 1)} aria-label="下一页">
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        ) : (
          <Link className="pageButton" href={pageHrefWithParams(page + 1, query, basePath, extraParams, pageParam)} aria-label="下一页">
            <ChevronRight size={18} aria-hidden="true" />
          </Link>
        )
      ) : (
        <span className="pageButton isDisabled" aria-hidden="true">
          <ChevronRight size={18} />
        </span>
      )}
    </nav>
  );
}
