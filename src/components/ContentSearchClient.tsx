"use client";

import { BookText } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Pagination } from "@/components/Pagination";
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
};

type SearchApiResponse = {
  ok: boolean;
  message?: string;
  job?: ContentJobSnapshot;
  jobId?: string;
  showProgressBars?: boolean;
};

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

  if (!job || job.status === "done") {
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
}: ContentSearchClientProps) {
  const [job, setJob] = useState<ContentJobSnapshot | null>(null);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(initialPage);
  const [displayProgress, setDisplayProgress] = useState(showProgressBars);
  const pageStateKey = useMemo(() => `content-search-page:${keyword}`, [keyword]);

  function rememberPage(nextPage: number) {
    window.sessionStorage.setItem(pageStateKey, String(nextPage));
  }

  function restoreInitialPage() {
    if (hasExplicitPage) {
      return initialPage;
    }

    const storedPage = Number(window.sessionStorage.getItem(pageStateKey));
    return Number.isFinite(storedPage) && storedPage > 0 ? Math.floor(storedPage) : initialPage;
  }

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

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
      setPage(nextPage);
      if (nextPage !== initialPage) {
        const url = new URL(window.location.href);
        url.searchParams.set("page", String(nextPage));
        window.history.replaceState(null, "", url.toString());
      }
      const response = await fetch("/api/search/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: keyword }),
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
      poll(data.jobId).catch((error) => setMessage(error instanceof Error ? error.message : "搜索失败"));
    }

    startSearch().catch((error) => {
      if (!cancelled) {
        setMessage(error instanceof Error ? error.message : "搜索失败");
      }
    });

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [keyword, initialPage, hasExplicitPage, pageStateKey, showProgressBars]);

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
    const url = new URL(window.location.href);
    url.searchParams.set("page", String(normalized));
    window.history.replaceState(null, "", url.toString());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const done = job?.status === "done";
  const failed = job?.status === "error";

  return (
    <>
      <section className="searchHero">
        {done && results.length ? (
          <p>
            找到 <strong>{results.length}</strong> 条，最多显示前 {maxResults} 条
          </p>
        ) : null}
        {done && !results.length ? <p className="searchMessage">未找到匹配正文</p> : null}
        {failed ? <p className="searchMessage">{job?.error || job?.message || "搜索失败"}</p> : null}
        {message ? <p className="searchMessage">{message}</p> : null}
      </section>

      <SearchProgress job={job} showProgressBars={displayProgress} />

      {pagedResults.length > 0 ? (
        <section className="searchResults">
          {pagedResults.map((result: SearchResult) => {
            const from = `/search?q=${encodeURIComponent(keyword)}&page=${currentPage}`;
            return (
              <Link
                className="searchResultCard"
                href={`/books/${result.novelId}?from=${encodeURIComponent(from)}&hit=${result.segmentIndex}#seg-${result.segmentIndex}`}
                key={`${result.novelId}-${result.segmentIndex}`}
                onClick={() => rememberPage(currentPage)}
              >
                <span className="bookMark" aria-hidden="true">
                  <BookText size={20} />
                </span>
                <span className="searchResultBody">
                  <strong>{result.title}</strong>
                  <span>{highlightSnippet(result.snippet, highlightTerms)}</span>
                </span>
              </Link>
            );
          })}
        </section>
      ) : null}

      {done && results.length > pageSize ? (
        <Pagination page={currentPage} totalPages={totalPages} query={keyword} basePath="/search" onPageChange={changePage} />
      ) : null}
    </>
  );
}
