"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SearchTrackedLink } from "@/components/SearchTrackedLink";
import type { ContentJobSnapshot } from "@/lib/content-jobs";
import type { SearchResult } from "@/lib/search";
import { findSearchTermRanges, type SearchTermPattern } from "@/lib/search-query";
import { localeFromPathname, uiText, type AppLocale } from "@/lib/locale";

type ContentSearchClientProps = {
  keyword: string;
  initialPage: number;
  hasExplicitPage: boolean;
  pageSize: number;
  highlightTerms: SearchTermPattern[];
  searchEventKey: string | null;
  searchSource: string;
  originNovelId: number | null;
  library?: string;
  requestFilters?: {
    includeTags: string[];
    excludeTags: string[];
    titleQuery: string;
    sourceLibrary?: string;
  };
  resultReturnPath?: string;
  resultReturnParams?: Record<string, string>;
  scrollTargetId?: string;
};

type SearchApiResponse = {
  ok: boolean;
  message?: string;
  job?: ContentJobSnapshot;
  jobId?: string;
};

type CachedContentSearch = {
  savedAt: number;
  page: number;
  job: ContentJobSnapshot;
};

const CONTENT_SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const CONTENT_SEARCH_HISTORY_KEY = "__novelContentSearch";

type ContentSearchHistoryState = {
  searchIdentity: string;
  page: number;
};

function removeSessionValue(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Search remains usable when browser storage is unavailable.
  }
}

function readSessionValue(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Search remains usable when browser storage is unavailable.
  }
}

function readCachedSearch(key: string): CachedContentSearch | null {
  try {
    const raw = readSessionValue(key);
    if (!raw) {
      return null;
    }
    const cached = JSON.parse(raw) as CachedContentSearch;
    if (!cached.job || Date.now() - cached.savedAt > CONTENT_SEARCH_CACHE_TTL_MS) {
      removeSessionValue(key);
      return null;
    }
    return cached;
  } catch {
    removeSessionValue(key);
    return null;
  }
}

function writeCachedSearch(key: string, job: ContentJobSnapshot, page: number) {
  writeSessionValue(key, JSON.stringify({ savedAt: Date.now(), page, job }));
}

function cancelSearchJob(jobId: string) {
  fetch(`/api/search/content?id=${encodeURIComponent(jobId)}`, { method: "DELETE", cache: "no-store", keepalive: true }).catch(() => undefined);
}

function normalizePage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) {
    return 1;
  }
  return Math.min(Math.floor(page), Math.max(totalPages, 1));
}

function highlightSnippet(snippet: string, terms: SearchTermPattern[]) {
  const ranges = findSearchTermRanges(snippet, terms);
  if (!ranges.length) {
    return snippet;
  }

  const nodes = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) {
      nodes.push(<span key={`text-${cursor}`}>{snippet.slice(cursor, range.start)}</span>);
    }
    nodes.push(<mark key={`mark-${range.start}`}>{snippet.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < snippet.length) {
    nodes.push(<span key={`text-${cursor}`}>{snippet.slice(cursor)}</span>);
  }
  return nodes;
}

function SearchProgress({
  job,
  locale,
}: {
  job: ContentJobSnapshot | null;
  locale: AppLocale;
}) {
  const scannedBooks = job?.scannedBooks || 0;
  const totalBooks = job?.totalBooks || 0;

  if (!job || job.status === "done" || job.status === "cancelled" || job.status === "error") {
    return null;
  }

  const detail = totalBooks
    ? locale === "zh-Hant"
      ? `已掃描 ${scannedBooks} / ${totalBooks} 本 · 符合 ${job.resultCount} 本`
      : `已扫描 ${scannedBooks} / ${totalBooks} 本 · 匹配 ${job.resultCount} 本`
    : uiText(locale, "正在启动搜索任务");
  return (
    <section className="contentProgressPanel contentProgressPanelCompact" aria-live="polite">
      <span>{job.message || uiText(locale, "正在搜索正文")}</span>
      <small>{detail}</small>
    </section>
  );
}

export function ContentSearchClient({
  keyword,
  initialPage,
  hasExplicitPage,
  pageSize,
  highlightTerms,
  searchEventKey,
  searchSource,
  originNovelId,
  library = "default",
  requestFilters,
  resultReturnPath = "/search",
  resultReturnParams = {},
  scrollTargetId,
}: ContentSearchClientProps) {
  const pathname = usePathname();
  const locale = localeFromPathname(pathname);
  const tr = (text: string) => uiText(locale, text);
  const [job, setJob] = useState<ContentJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(initialPage);
  const requestFiltersKey = useMemo(() => JSON.stringify(requestFilters || null), [requestFilters]);
  const searchIdentity = `${library}:${keyword}:${requestFiltersKey}`;
  const pageStateKey = useMemo(() => `content-search-page:${searchIdentity}`, [searchIdentity]);
  const resultCacheKey = useMemo(() => `content-search-results:${searchIdentity}`, [searchIdentity]);
  const currentPageRef = useRef(initialPage);
  const activeJobIdRef = useRef("");
  const activeJobStatusRef = useRef<ContentJobSnapshot["status"] | "">("");
  const keepJobOnUnmountRef = useRef(false);
  const pendingCancelRef = useRef<{ searchIdentity: string; jobId: string } | null>(null);
  const pendingCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportedAnalyticsRef = useRef("");
  const storedSnapshotSignatureRef = useRef("");

  function reportSearchResults(nextJob: ContentJobSnapshot) {
    if (!searchEventKey || nextJob.status !== "done") return;
    const completedResults = nextJob.results || [];
    const resultCount = completedResults.length;
    const resultNovelCount = new Set(completedResults.map((result) => result.novelId)).size;
    const signature = `${searchEventKey}:${resultCount}:${resultNovelCount}`;
    if (reportedAnalyticsRef.current === signature) return;
    reportedAnalyticsRef.current = signature;
    void fetch("/api/search/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "results", eventKey: searchEventKey, resultCount, resultNovelCount }),
      keepalive: true,
    }).catch(() => {
      if (reportedAnalyticsRef.current === signature) reportedAnalyticsRef.current = "";
    });
  }

  function rememberPage(nextPage: number) {
    currentPageRef.current = nextPage;
    writeSessionValue(pageStateKey, String(nextPage));
  }

  function rememberSnapshot(nextJob: ContentJobSnapshot, nextPage = currentPageRef.current) {
    activeJobIdRef.current = nextJob.id;
    activeJobStatusRef.current = nextJob.status;
    const signature = `${nextJob.id}:${nextJob.status}:${nextJob.resultCount}:${nextPage}`;
    if (storedSnapshotSignatureRef.current !== signature) {
      storedSnapshotSignatureRef.current = signature;
      writeCachedSearch(resultCacheKey, nextJob, nextPage);
    }
    reportSearchResults(nextJob);
  }

  function clearPendingCancel() {
    if (pendingCancelTimerRef.current) {
      clearTimeout(pendingCancelTimerRef.current);
      pendingCancelTimerRef.current = null;
    }
    pendingCancelRef.current = null;
  }

  function restoreInitialPage() {
    const browserPage = Number(new URL(window.location.href).searchParams.get("page"));
    if (Number.isFinite(browserPage) && browserPage > 0) {
      return Math.floor(browserPage);
    }
    if (hasExplicitPage) {
      return initialPage;
    }

    const storedPage = Number(readSessionValue(pageStateKey));
    return Number.isFinite(storedPage) && storedPage > 0 ? Math.floor(storedPage) : initialPage;
  }

  useLayoutEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    keepJobOnUnmountRef.current = false;
    if (pendingCancelRef.current?.searchIdentity === searchIdentity) {
      clearPendingCancel();
    }

    async function poll(jobId: string) {
      const response = await fetch(`/api/search/content?id=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const data = (await response.json()) as SearchApiResponse;
      if (cancelled) {
        return;
      }
      if (!response.ok || !data.ok || !data.job) {
        throw new Error(data.message || tr("搜索任务状态读取失败"));
      }
      let nextJob = data.job;
      if (nextJob.status === "done" && !nextJob.results) {
        const resultResponse = await fetch(
          `/api/search/content?id=${encodeURIComponent(jobId)}&results=1`,
          { cache: "no-store" },
        );
        const resultData = (await resultResponse.json()) as SearchApiResponse;
        if (!resultResponse.ok || !resultData.ok || !resultData.job) {
          throw new Error(resultData.message || tr("搜索结果读取失败"));
        }
        nextJob = resultData.job;
      }
      setJob(nextJob);
      rememberSnapshot(nextJob);
      if (nextJob.status === "running" || nextJob.status === "queued") {
        timer = setTimeout(() => {
          poll(jobId).catch((error) => setMessage(error instanceof Error ? error.message : tr("搜索失败")));
        }, document.visibilityState === "hidden" ? 2_000 : 800);
      }
    }

    async function startSearch() {
      setJob(null);
      setMessage("");
      const nextPage = restoreInitialPage();
      const cached = readCachedSearch(resultCacheKey);
      currentPageRef.current = nextPage;
      setPage(nextPage);
      const url = new URL(window.location.href);
      let replaceUrl = false;
      if (nextPage !== initialPage) {
        url.searchParams.set("page", String(nextPage));
        replaceUrl = true;
      }
      if (searchEventKey && url.searchParams.get("searchEvent") !== searchEventKey) {
        url.searchParams.set("searchEvent", searchEventKey);
        replaceUrl = true;
      }
      window.history.replaceState(
        { [CONTENT_SEARCH_HISTORY_KEY]: { searchIdentity, page: nextPage } satisfies ContentSearchHistoryState },
        "",
        replaceUrl ? url.toString() : undefined,
      );

      if (cached?.job) {
        const cachedResultCount = cached.job.results?.length || 0;
        const cachedPage = url.searchParams.has("page")
          ? nextPage
          : normalizePage(cached.page || nextPage, Math.max(1, Math.ceil(cachedResultCount / pageSize)));
        currentPageRef.current = cachedPage;
        setPage(cachedPage);
        setJob(cached.job);
        rememberSnapshot(cached.job, cachedPage);
        if (cached.job.status === "done") {
          return;
        }
        if (cached.job.status === "running" || cached.job.status === "queued") {
          poll(cached.job.id).catch((error) => setMessage(error instanceof Error ? error.message : tr("搜索失败")));
          return;
        }
      }

      const response = await fetch("/api/search/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: keyword,
          library,
          ...(requestFiltersKey === "null" ? {} : { filters: JSON.parse(requestFiltersKey) }),
        }),
      });
      const data = (await response.json()) as SearchApiResponse;
      if (cancelled) {
        return;
      }
      if (!response.ok || !data.ok || !data.jobId || !data.job) {
        throw new Error(data.message || tr("搜索启动失败"));
      }
      if (data.job.status === "done" && !data.job.results) {
        await poll(data.jobId);
        return;
      }
      setJob(data.job);
      rememberSnapshot(data.job, nextPage);
      if (data.job.status === "running" || data.job.status === "queued") {
        poll(data.jobId).catch((error) => setMessage(error instanceof Error ? error.message : tr("搜索失败")));
      }
    }

    function cancelActiveJob() {
      const jobId = activeJobIdRef.current;
      const status = activeJobStatusRef.current;
      if (jobId && (status === "running" || status === "queued")) {
        cancelSearchJob(jobId);
      }
    }

    function scheduleCancelActiveJob() {
      const jobId = activeJobIdRef.current;
      const status = activeJobStatusRef.current;
      if (!jobId || (status !== "running" && status !== "queued")) {
        return;
      }
      pendingCancelRef.current = { searchIdentity, jobId };
      pendingCancelTimerRef.current = setTimeout(() => {
        if (pendingCancelRef.current?.jobId === jobId) {
          cancelSearchJob(jobId);
          clearPendingCancel();
        }
      }, 300);
    }

    function handlePageHide() {
      if (!keepJobOnUnmountRef.current) {
        cancelActiveJob();
      }
    }

    startSearch().catch((error) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : tr("搜索失败"));
      }
    });
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      window.removeEventListener("pagehide", handlePageHide);
      if (!keepJobOnUnmountRef.current) {
        scheduleCancelActiveJob();
      }
    };
  }, [keyword, initialPage, hasExplicitPage, pageStateKey, requestFiltersKey, resultCacheKey, pageSize, searchIdentity, searchEventKey]);

  const results = job?.results || [];
  const matchedBookCount = useMemo(() => new Set(results.map((result) => result.novelId)).size, [results]);
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = normalizePage(page, totalPages);
  const pagedResults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [currentPage, pageSize, results]);

  function changePage(nextPage: number) {
    const normalized = normalizePage(nextPage, totalPages);
    const url = new URL(window.location.href);
    if (normalized > 1) url.searchParams.set("page", String(normalized));
    else url.searchParams.delete("page");
    window.history.pushState(
      { [CONTENT_SEARCH_HISTORY_KEY]: { searchIdentity, page: normalized } satisfies ContentSearchHistoryState },
      "",
      url.toString(),
    );
    setPage(normalized);
    rememberPage(normalized);
    if (job) {
      writeCachedSearch(resultCacheKey, job, normalized);
    }
  }

  useEffect(() => {
    function restoreHistoryPage(event: PopStateEvent) {
      const state = event.state?.[CONTENT_SEARCH_HISTORY_KEY] as ContentSearchHistoryState | undefined;
      if (!state || state.searchIdentity !== searchIdentity) return;
      const restoredPage = normalizePage(state.page, totalPages);
      currentPageRef.current = restoredPage;
      writeSessionValue(pageStateKey, String(restoredPage));
      setPage(restoredPage);
    }
    window.addEventListener("popstate", restoreHistoryPage);
    return () => window.removeEventListener("popstate", restoreHistoryPage);
  }, [pageStateKey, searchIdentity, totalPages]);

  const done = job?.status === "done";
  const failed = job?.status === "error";
  const cancelled = job?.status === "cancelled";
  const showResultCount = Boolean(job) && !failed && !cancelled && (done || matchedBookCount > 0);

  return (
    <>
      <section className={showResultCount ? "searchHero hasResultCount" : "searchHero"}>
        {showResultCount ? <ResultCount count={matchedBookCount} /> : null}
        {failed ? <p className="searchMessage">{job?.error || job?.message || tr("搜索失败")}</p> : null}
        {cancelled ? <p className="searchMessage">{job?.message || tr("全文搜索任务已取消")}</p> : null}
        {message ? <p className="searchMessage">{message}</p> : null}
      </section>

      <SearchProgress job={job} locale={locale} />

      {pagedResults.length > 0 ? (
        <section className="searchResults contentSearchResults">
          {pagedResults.map((result: SearchResult) => {
            const fromParams = new URLSearchParams(resultReturnParams);
            if (resultReturnPath === "/search") fromParams.set("q", keyword);
            fromParams.set("page", String(currentPage));
            if (searchSource !== "direct") fromParams.set("source", searchSource);
            if (originNovelId) fromParams.set("origin", String(originNovelId));
            if (searchEventKey) fromParams.set("searchEvent", searchEventKey);
            const from = `${resultReturnPath}?${fromParams.toString()}`;
            return (
              <SearchTrackedLink
                className="searchResultCard"
                eventKey={searchEventKey}
                href={`${result.chapterId
                  ? `/books/${result.novelId}/chapters/${result.chapterId}`
                  : `/books/${result.novelId}`}?from=${encodeURIComponent(from)}&hit=${result.segmentIndex}#seg-${result.segmentIndex}`}
                novelId={result.novelId}
                returnHref={from}
                segmentIndex={result.segmentIndex}
                key={`${result.novelId}-${result.chapterId || 0}-${result.segmentIndex}`}
                onClick={() => {
                  keepJobOnUnmountRef.current = true;
                  rememberPage(currentPage);
                  if (job) {
                    writeCachedSearch(resultCacheKey, job, currentPage);
                  }
                }}
              >
                <span className="searchResultBody">
                  <strong>{result.title}</strong>
                  <span>{highlightSnippet(result.snippet, highlightTerms)}</span>
                </span>
              </SearchTrackedLink>
            );
          })}
        </section>
      ) : null}

      {results.length > pageSize ? (
        <Pagination page={currentPage} totalPages={totalPages} query={keyword} basePath={resultReturnPath} onPageChange={changePage} scrollTargetId={scrollTargetId} />
      ) : null}
    </>
  );
}
