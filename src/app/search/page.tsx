import { BookText } from "lucide-react";
import { headers } from "next/headers";
import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getGlobalSearchMaxResults,
  getSearchRateLimitPerMinute,
  getSearchResultsPageSize,
  getSearchShortQueryRateLimitPerMinute,
} from "@/lib/config";
import { checkRateLimit } from "@/lib/rate-limit";
import { normalizeSearchPage, searchNovelContent, SearchResult, validateSearchKeyword } from "@/lib/search";
import { countSearchChars, findSearchTermRanges, SearchTermPattern } from "@/lib/search-query";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

function getClientKey(cookieHeader: string, forwardedFor: string | null): string {
  return forwardedFor?.split(",")[0]?.trim() || cookieHeader || "anonymous";
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

function renderResults(results: SearchResult[], keyword: string, terms: SearchTermPattern[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize).map((result) => {
    const from = `/search?q=${encodeURIComponent(keyword)}&page=${page}`;
    return (
      <Link
        className="searchResultCard"
        href={`/books/${result.novelId}?from=${encodeURIComponent(from)}&hit=${result.segmentIndex}#seg-${result.segmentIndex}`}
        key={`${result.novelId}-${result.segmentIndex}`}
      >
        <span className="bookMark" aria-hidden="true">
          <BookText size={20} />
        </span>
        <span className="searchResultBody">
          <strong>{result.title}</strong>
          <span>{highlightSnippet(result.snippet, terms)}</span>
        </span>
      </Link>
    );
  });
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const validation = validateSearchKeyword(params.q);
  const pageSize = getSearchResultsPageSize();
  const maxResults = getGlobalSearchMaxResults();
  const headerStore = await headers();
  let results: SearchResult[] = [];
  let message = validation.ok ? "" : validation.message;

  if (validation.ok) {
    const perMinute =
      countSearchChars(validation.query.anchorTerm) === 2 ? getSearchShortQueryRateLimitPerMinute() : getSearchRateLimitPerMinute();
    const limit = checkRateLimit({
      key: `search:${getClientKey(headerStore.get("cookie") || "", headerStore.get("x-forwarded-for"))}`,
      limit: perMinute,
      windowMs: 60_000,
    });

    if (!limit.allowed) {
      message = `搜索太频繁，请 ${limit.retryAfterSeconds} 秒后再试`;
    } else {
      results = searchNovelContent(validation.query);
      message = results.length ? "" : "没有找到匹配正文";
    }
  }

  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = normalizeSearchPage(params.page, totalPages);

  return (
    <main className="appShell">
      <SiteHeader query={validation.keyword} defaultSearchMode="content" />
      <section className="searchHero">
        {validation.ok && results.length ? (
          <p>
            找到 <strong>{results.length}</strong> 本，最多显示前 {maxResults} 条
          </p>
        ) : null}
        {message ? <p className="searchMessage">{message}</p> : null}
      </section>

      {results.length > 0 && validation.ok ? (
        <section className="searchResults">{renderResults(results, validation.keyword, validation.query.highlightTerms, page, pageSize)}</section>
      ) : null}

      {results.length > pageSize ? <Pagination page={page} totalPages={totalPages} query={validation.keyword} basePath="/search" /> : null}
    </main>
  );
}
