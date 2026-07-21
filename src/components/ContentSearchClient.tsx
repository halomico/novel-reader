"use client";

import { BookText } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pagination } from "@/components/Pagination";
import { SearchTrackedLink } from "@/components/SearchTrackedLink";
import type { ContentJobSnapshot } from "@/lib/content-jobs";
import type { SearchResult } from "@/lib/search";
import { findSearchTermRanges, type SearchTermPattern } from "@/lib/search-query";

type ContentSearchClientProps = {
  keyword: string;
  initialPage: number;
  hasExplicitPage: boolean;
  pageSize: number;
  maxResults: number;
  highlightTerms: SearchTermPattern[];
  showProgressBars: boolean;
  searchEventKey: string | null;
  searchSource: string;
  originNovelId: number | null;
  requestFilters?: {
    includeTags: string[];
    excludeTags: string[];
    titleQuery: string;
  };
  resultReturnPath?: string;
  resultReturnParams?: Record<string, string>;
};

type SearchApiResponse = {
  ok: boolean;
  message?: string;
  job?: ContentJobSnapshot;
  jobId?: string;
  showProgressBars?: boolean;
};

type CachedContentSearch = {
  savedAt: number;
  page: number;
  showProgressBars: boolean;
  job: ContentJobSnapshot;
};

const CONTENT_SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;

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

function writeCachedSearch(key: string, job: ContentJobSnapshot, page: number, showProgressBars: boolean) {
  writeSessionValue(key, JSON.stringify({ savedAt: Date.now(), page, showProgressBars, job }));
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

function SearchProgress({ job, showProgressBars }: { job: ContentJobSnapshot | null; showProgressBars: boolean }) {
  const progress = job?.progress || 0;
  const scannedBooks = job?.scannedBooks || 0;
  const totalBooks = job?.totalBooks || 0;

  if (!job || job.status === "done" || job.status === "cancelled" || job.status === "error") {
    return null;
  }

  return (
    <section className="contentProgressPanel" aria-live="polite">
      <div className="contentProgressHeader">
        <span>{job.message || "正在搜索正文"}</span>
        {showProgressBars ? <strong>{progress}%</strong> : null}
      </div>
      {showProgressBars ? (
        <div className="contentProgressTrack" aria-label="搜索进度">
          <span style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {totalBooks ? (
        <p>
          已扫描 {scannedBooks} / {totalBooks} 本，当前匹配 {job.resultCount} 条
        </p>
      ) : (
        <p>正在启动搜索任务</p>
      )}
    </section>
  );
}

export function ContentSearchClient({
  keyword,
  initialPage,
  hasExplicitPage,
  pageSize,
  maxResults,
  highlightTerms,
  showProgressBars,
  searchEventKey,
  searchSource,
  originNovelId,
  requestFilters,
  resultReturnPath = "/search",
  resultReturnParams = {},
}: ContentSearchClientProps) {
  const [job, setJob] = useState<ContentJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(initialPage);
  const [displayProgress, setDisplayProgress] = useState(showProgressBars);
  const requestFiltersKey = useMemo(() => JSON.stringify(requestFilters || null), [requestFilters]);
  const searchIdentity = `${keyword}:${requestFiltersKey}`;
  const pageStateKey = useMemo(() => `content-search-page:${searchIdentity}`, [searchIdentity]);
  const resultCacheKey = useMemo(() => `content-search-results:${searchIdentity}`, [searchIdentity]);
  const currentPageRef = useRef(initialPage);
  const activeJobIdRef = useRef("");
  const activeJobStatusRef = useRef<ContentJobSnapshot["status"] | "">("");
  const keepJobOnUnmountRef = useRef(false);
  const pendingCancelRef = useRef<{ searchIdentity: string; jobId: string } | null>(null);
  const pendingCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reportedAnalyticsRef = useRef("");

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

  function rememberSnapshot(nextJob: ContentJobSnapshot, nextPage = currentPageRef.current, nextShowProgressBars = displayProgress) {
    activeJobIdRef.current = nextJob.id;
    activeJobStatusRef.current = nextJob.status;
    writeCachedSearch(resultCacheKey, nextJob, nextPage, nextShowProgressBars);
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
    if (hasExplicitPage) {
      return initialPage;
    }

    const storedPage = Number(readSessionValue(pageStateKey));
    return Number.isFinite(storedPage) && storedPage > 0 ? Math.floor(storedPage) : initialPage;
  }

  useEffect(() => {
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
        throw new Error(data.message || "搜索任务状态读取失败");
      }
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
      rememberSnapshot(data.job, currentPageRef.current, data.showProgressBars ?? showProgressBars);
      if (data.job.status === "running" || data.job.status === "queued") {
        timer = setTimeout(() => {
          poll(jobId).catch((error) => setMessage(error instanceof Error ? error.message : "搜索失败"));
        }, 700);
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
      if (replaceUrl) window.history.replaceState(null, "", url.toString());

      if (cached?.job) {
        const cachedResultCount = cached.job.results?.length || 0;
        const cachedPage = hasExplicitPage
          ? nextPage
          : normalizePage(cached.page || nextPage, Math.max(1, Math.ceil(cachedResultCount / pageSize)));
        currentPageRef.current = cachedPage;
        setPage(cachedPage);
        setJob(cached.job);
        setDisplayProgress(cached.showProgressBars);
        rememberSnapshot(cached.job, cachedPage, cached.showProgressBars);
        if (cached.job.status === "done") {
          return;
        }
        if (cached.job.status === "running" || cached.job.status === "queued") {
          poll(cached.job.id).catch((error) => setMessage(error instanceof Error ? error.message : "搜索失败"));
          return;
        }
      }

      const response = await fetch("/api/search/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          q: keyword,
          ...(requestFiltersKey === "null" ? {} : { filters: JSON.parse(requestFiltersKey) }),
        }),
      });
      const data = (await response.json()) as SearchApiResponse;
      if (cancelled) {
        return;
      }
      if (!response.ok || !data.ok || !data.jobId || !data.job) {
        throw new Error(data.message || "搜索启动失败");
      }
      setJob(data.job);
      setDisplayProgress(data.showProgressBars ?? showProgressBars);
      rememberSnapshot(data.job, nextPage, data.showProgressBars ?? showProgressBars);
      poll(data.jobId).catch((error) => setMessage(error instanceof Error ? error.message : "搜索失败"));
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
        setMessage(error instanceof Error ? error.message : "搜索失败");
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
  }, [keyword, initialPage, hasExplicitPage, pageStateKey, requestFiltersKey, resultCacheKey, pageSize, searchIdentity, showProgressBars, searchEventKey]);

  const results = job?.results || [];
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const currentPage = normalizePage(page, totalPages);
  const pagedResults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return results.slice(start, start + pageSize);
  }, [currentPage, pageSize, results]);

  function changePage(nextPage: number) {
    const normalized = normalizePage(nextPage, totalPages);
    setPage(normalized);
    rememberPage(normalized);
    if (job) {
      writeCachedSearch(resultCacheKey, job, normalized, displayProgress);
    }
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(normalized));
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const done = job?.status === "done";
  const failed = job?.status === "error";
  const cancelled = job?.status === "cancelled";

  return (
    <>
      <section className="searchHero">
        {results.length ? (
          <p>
            {done ? "找到" : "已找到"} <strong>{results.length}</strong> 条，最多显示前 {maxResults} 条
          </p>
        ) : null}
        {done && !results.length ? <p className="searchMessage">未找到匹配正文</p> : null}
        {failed ? <p className="searchMessage">{job?.error || job?.message || "搜索失败"}</p> : null}
        {cancelled ? <p className="searchMessage">{job?.message || "全文搜索任务已取消"}</p> : null}
        {message ? <p className="searchMessage">{message}</p> : null}
      </section>

      <SearchProgress job={job} showProgressBars={displayProgress} />

      {pagedResults.length > 0 ? (
        <section className="searchResults">
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
                href={`/books/${result.novelId}?from=${encodeURIComponent(from)}&hit=${result.segmentIndex}#seg-${result.segmentIndex}`}
                novelId={result.novelId}
                segmentIndex={result.segmentIndex}
                key={`${result.novelId}-${result.segmentIndex}`}
                onClick={() => {
                  keepJobOnUnmountRef.current = true;
                  rememberPage(currentPage);
                  if (job) {
                    writeCachedSearch(resultCacheKey, job, currentPage, displayProgress);
                  }
                }}
              >
                <span className="bookMark" aria-hidden="true">
                  <BookText size={20} />
                </span>
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
        <Pagination page={currentPage} totalPages={totalPages} query={keyword} basePath={resultReturnPath} onPageChange={changePage} />
      ) : null}
    </>
  );
}
