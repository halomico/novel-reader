import { BookText } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContextNavigationLink } from "@/components/ContextNavigationLink";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SiteHeader } from "@/components/SiteHeader";
import { getNovelById } from "@/lib/books";
import { canAccessNovelLibrary, getSearchResultsPageSize } from "@/lib/config";
import { checkContentAccess } from "@/lib/content-access";
import { getRequestLocale, localizeText, localizeTexts, normalizeSearchText } from "@/lib/locale-server";
import { getNovelReadAccess } from "@/lib/novel-access";
import { getNovelSourceById } from "@/lib/novel-library";
import { findSearchTermRanges } from "@/lib/search-query";
import { searchNovelBookContent, validateSearchKeyword } from "@/lib/search";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "本书搜索", robots: NO_INDEX_ROBOTS };

type BookSearchPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
};

function highlightSnippet(snippet: string, terms: Parameters<typeof findSearchTermRanges>[1]) {
  const ranges = findSearchTermRanges(snippet, terms);
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

export default async function BookSearchPage({ params, searchParams }: BookSearchPageProps) {
  const bookId = Number((await params).id);
  if (!Number.isInteger(bookId) || bookId < 1) notFound();
  const book = getNovelById(bookId);
  if (!book || book.storage_mode !== "chapters") notFound();
  const user = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(user))) notFound();
  const access = checkContentAccess(await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed || !getNovelReadAccess(book, user).allowed) notFound();

  const queryParams = await searchParams;
  const originalQuery = queryParams.q || "";
  const validation = validateSearchKeyword(await normalizeSearchText(originalQuery));
  const locale = await getRequestLocale();
  const library = book.source_id ? getNovelSourceById(book.source_id)?.slug || "default" : "default";
  const pageSize = getSearchResultsPageSize();
  const requestedPage = Math.max(Math.floor(Number(queryParams.page || 1)) || 1, 1);
  const results = validation.ok ? await searchNovelBookContent(book, validation.query) : [];
  const totalPages = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const pagedResults = results.slice((page - 1) * pageSize, page * pageSize);
  const localizedResults = await Promise.all(pagedResults.map(async (result) => ({
    ...result,
    title: await localizeText(result.title, locale),
    snippet: await localizeText(result.snippet, locale),
  })));
  const [homeLabel, novelsLabel, bookSearchLabel, displayTitle] = await localizeTexts(
    ["首页", "小说", "本书搜索", book.title] as const,
    locale,
  );
  const basePath = `/books/${book.id}/search`;

  return (
    <main className="appShell">
      <SiteHeader
        query={originalQuery}
        defaultSearchMode="current"
        defaultSearchExpanded
        showCurrentSearch
        currentSearchBookId={book.id}
        currentUser={user}
        library={library}
      />
      <Breadcrumbs items={[
        { label: homeLabel, href: "/" },
        { label: novelsLabel, href: library === "default" ? "/novels" : `/novels?library=${encodeURIComponent(library)}` },
        { label: displayTitle, href: `/books/${book.id}/chapters` },
        { label: bookSearchLabel },
      ]} />
      <section className={validation.ok && results.length ? "searchHero hasResultCount" : "searchHero"}>
        {validation.ok && results.length ? <ResultCount count={results.length} /> : null}
        <p className="searchMessage">
          {validation.ok
            ? results.length ? `仅在《${displayTitle}》的章节中即时搜索，不占用全文索引空间。` : "本书没有匹配内容。"
            : validation.message}
        </p>
      </section>
      {localizedResults.length ? (
        <section className="searchResults">
          {localizedResults.map((result) => {
            const from = `${basePath}?q=${encodeURIComponent(originalQuery)}&page=${page}`;
            return (
              <ContextNavigationLink
                className="searchResultCard"
                contextReturnHref={from}
                href={`/books/${book.id}/chapters/${result.chapterId}?from=${encodeURIComponent(from)}&hit=${result.segmentIndex}#seg-${result.segmentIndex}`}
                key={`${result.chapterId}-${result.segmentIndex}`}
                prefetch={false}
              >
                <span className="bookMark" aria-hidden="true"><BookText size={20} /></span>
                <span className="searchResultBody">
                  <strong>{result.title}</strong>
                  <span>{validation.ok ? highlightSnippet(result.snippet, validation.query.highlightTerms) : result.snippet}</span>
                </span>
              </ContextNavigationLink>
            );
          })}
        </section>
      ) : null}
      {results.length > pageSize ? (
        <Pagination page={page} totalPages={totalPages} query={originalQuery} basePath={basePath} />
      ) : null}
    </main>
  );
}
