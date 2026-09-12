"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SearchTrackedLink } from "@/components/SearchTrackedLink";
import type { PostgresContentSearchItem } from "@/domains/reading/postgres-content-search";
import { localeFromPathname, uiText } from "@/lib/locale";
import { findSearchTermRanges, type SearchTermPattern } from "@/lib/search-query";
import { createTimedCache } from "@/lib/timed-cache";

type ContentSearchClientProps = {
  keyword: string;
  initialPage: number;
  highlightTerms: readonly SearchTermPattern[];
  searchEventKey: string | null;
  searchSource: string;
  originNovelId: number | null;
  library?: string;
  novelId?: number;
  requestFilters?: {
    includeTags: string[];
    excludeTags: string[];
    titleQuery: string;
  };
  resultReturnPath?: string;
  resultReturnParams?: Record<string, string>;
  scrollTargetId?: string;
  emptyMessage?: string;
};

type CachedResults = {
  items: PostgresContentSearchItem[];
  totalNovels: number;
  totalPages: number;
  estimated: boolean;
};

// Results stay for a minute per tab, as long as the router keeps a visited page, so going
// back to a search (or paging back and forth) renders at once and keeps the scroll
// position instead of re-running the query behind a loading message.
const resultCache = createTimedCache<CachedResults>({ ttlMs: 60_000, maxEntries: 32 });

type SearchApiResponse = {
  ok: boolean;
  message?: string;
  items?: PostgresContentSearchItem[];
  totalItems?: number;
  totalNovels?: number;
  totalPages?: number;
  estimated?: boolean;
};

function highlightSnippet(
  snippet: string,
  serverRanges: readonly { start: number; end: number }[] | undefined,
  terms: readonly SearchTermPattern[],
) {
  const ranges = serverRanges?.length ? serverRanges : findSearchTermRanges(snippet, terms);
  if (!ranges.length) return snippet;
  const nodes = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) nodes.push(<span key={`text-${cursor}`}>{snippet.slice(cursor, range.start)}</span>);
    nodes.push(<mark key={`mark-${range.start}`}>{snippet.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < snippet.length) nodes.push(<span key={`text-${cursor}`}>{snippet.slice(cursor)}</span>);
  return nodes;
}

function updateHistory(page: number, replace = false) {
  const url = new URL(window.location.href);
  if (page > 1) url.searchParams.set("page", String(page));
  else url.searchParams.delete("page");
  url.searchParams.delete("cursor");
  window.history[replace ? "replaceState" : "pushState"]({}, "", url.toString());
}

export function ContentSearchClient({
  keyword,
  initialPage,
  highlightTerms,
  searchEventKey,
  searchSource,
  originNovelId,
  library = "default",
  novelId,
  requestFilters,
  resultReturnPath = "/search",
  resultReturnParams = {},
  scrollTargetId,
  emptyMessage,
}: ContentSearchClientProps) {
  const pathname = usePathname();
  const locale = localeFromPathname(pathname);
  const tr = (text: string) => uiText(locale, text);
  const requestFiltersKey = useMemo(() => JSON.stringify(requestFilters || null), [requestFilters]);
  const queryKey = `${keyword}::${library}::${novelId ?? ""}::${requestFiltersKey}`;
  const activeQueryRef = useRef(queryKey);
  const [prevQueryKey, setPrevQueryKey] = useState(queryKey);
  const [page, setPage] = useState(() => Math.max(1, initialPage));

  if (prevQueryKey !== queryKey) {
    setPrevQueryKey(queryKey);
    setPage(Math.max(1, initialPage));
    activeQueryRef.current = queryKey;
  }

  const resultKey = (resultPage: number) => JSON.stringify([locale, keyword, library, novelId ?? null, resultPage, requestFiltersKey]);
  const [initialResults] = useState(() => resultCache.get(resultKey(Math.max(1, initialPage))));
  const [items, setItems] = useState<PostgresContentSearchItem[]>(initialResults?.items ?? []);
  const [totalNovels, setTotalNovels] = useState(initialResults?.totalNovels ?? 0);
  const [totalPages, setTotalPages] = useState(initialResults?.totalPages ?? 1);
  const [estimated, setEstimated] = useState(initialResults?.estimated ?? false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(!initialResults);
  const reportedAnalyticsRef = useRef("");

  useEffect(() => {
    const requestKey = resultKey(page);
    const cached = resultCache.get(requestKey);
    if (cached) {
      setItems(cached.items);
      setTotalNovels(cached.totalNovels);
      setTotalPages(cached.totalPages);
      setEstimated(cached.estimated);
      setMessage("");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setMessage("");
    void fetch("/api/search/content", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
      body: JSON.stringify({
        q: keyword,
        library,
        novelId,
        page,
        ...(requestFiltersKey === "null" ? {} : { filters: JSON.parse(requestFiltersKey) }),
      }),
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      // A proxy timeout or crash page is HTML, not the API's JSON error.
      const data = await response.json().catch(() => null) as SearchApiResponse | null;
      if (controller.signal.aborted || activeQueryRef.current !== queryKey) return;
      if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
        throw new Error(data?.message || tr(response.status === 429 ? "搜索人数较多，请稍后再试" : "搜索失败"));
      }
      if (!Number.isSafeInteger(data.totalItems) || Number(data.totalItems) < 0 ||
          !Number.isSafeInteger(data.totalNovels) || Number(data.totalNovels) < 0 ||
          !Number.isSafeInteger(data.totalPages) || Number(data.totalPages) < 1) {
        throw new Error(tr("搜索失败"));
      }
      const resultPages = Number(data.totalPages);
      if (page > resultPages) {
        updateHistory(resultPages, true);
        setPage(resultPages);
        return;
      }
      setTotalNovels(Number(data.totalNovels));
      setTotalPages(resultPages);
      setEstimated(data.estimated === true);
      setItems(data.items);
      resultCache.set(requestKey, {
        items: data.items,
        totalNovels: Number(data.totalNovels),
        totalPages: resultPages,
        estimated: data.estimated === true,
      });
      if (searchEventKey && page === 1) {
        const signature = `${searchEventKey}:${data.totalItems}:${data.totalNovels}`;
        if (reportedAnalyticsRef.current !== signature) {
          reportedAnalyticsRef.current = signature;
          void fetch("/api/search/analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
            body: JSON.stringify({ action: "results", eventKey: searchEventKey, resultCount: data.totalItems, resultNovelCount: data.totalNovels }),
            keepalive: true,
          }).catch(() => undefined);
        }
      }
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setItems([]);
      setTotalNovels(0);
      setTotalPages(1);
      setEstimated(false);
      setMessage(error instanceof Error ? error.message : tr("搜索失败"));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [keyword, library, locale, novelId, page, requestFiltersKey, searchEventKey]);

  useEffect(() => {
    function restorePage() {
      const url = new URL(window.location.href);
      const restoredPage = Number(url.searchParams.get("page") || 1);
      setPage(Number.isSafeInteger(restoredPage) && restoredPage > 1 ? restoredPage : 1);
    }
    window.addEventListener("popstate", restorePage);
    return () => window.removeEventListener("popstate", restorePage);
  }, []);

  function goToPage(nextPage: number) {
    if (nextPage === page || nextPage < 1 || nextPage > totalPages) return;
    updateHistory(nextPage);
    setPage(nextPage);
  }

  return (
    <>
      <section className="searchHero">
        {loading ? <p className="searchMessage" aria-live="polite">{tr("正在搜索正文")}</p> : null}
        {message ? <p className="searchMessage" role="alert">{message}</p> : null}
      </section>

      {!message && (!loading || items.length > 0) ? (
        <div className="contentSearchSummary">
          <ResultCount count={totalNovels} prefix={estimated ? tr("约") : undefined} />
        </div>
      ) : null}

      {!loading && !message && items.length === 0 ? (
        <section className="emptyState">
          <h2>{emptyMessage || tr("没有符合条件的小说")}</h2>
        </section>
      ) : null}

      {items.length ? (
        <section className="searchResults contentSearchResults" aria-busy={loading}>
          {items.map((result) => {
            const fromParams = new URLSearchParams(resultReturnParams);
            if (resultReturnPath === "/search") fromParams.set("q", keyword);
            if (page > 1) fromParams.set("page", String(page)); else fromParams.delete("page");
            fromParams.delete("cursor");
            if (searchSource !== "direct") fromParams.set("source", searchSource);
            if (originNovelId) fromParams.set("origin", String(originNovelId));
            if (searchEventKey) fromParams.set("searchEvent", searchEventKey);
            const from = `${resultReturnPath}?${fromParams.toString()}`;
            const destination = result.chapterId
              ? `/books/${result.novelId}/chapters/${result.chapterId}`
              : `/books/${result.novelId}`;
            const title = result.chapterTitle ? `${result.novelTitle} · ${result.chapterTitle}` : result.novelTitle;
            return (
              <SearchTrackedLink
                className="searchResultCard"
                eventKey={searchEventKey}
                href={`${destination}?from=${encodeURIComponent(from)}&at=${result.charStart}#search-hit`}
                novelId={result.novelId}
                returnHref={from}
                key={`${result.documentId}-${result.blockNo}`}
              >
                <span className="searchResultBody">
                  <strong>{title}</strong>
                  <span>{highlightSnippet(result.snippet, result.highlightRanges, highlightTerms)}</span>
                </span>
              </SearchTrackedLink>
            );
          })}
        </section>
      ) : null}

      {!message ? (
        <Pagination page={page} totalPages={totalPages} query="" onPageChange={goToPage} scrollTargetId={scrollTargetId} />
      ) : null}
    </>
  );
}
