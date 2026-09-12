import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { getPostgresNovelSourceById, getPostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import { getPostgresNovelReadAccess } from "@/domains/reading/postgres-novel-access";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { getRequestLocale, localizeTexts, normalizeSearchText } from "@/lib/locale-server";
import { validateSearchKeyword } from "@/lib/search-query";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "本书搜索", robots: NO_INDEX_ROBOTS };

type BookSearchPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
};

export default async function BookSearchPage({ params, searchParams }: BookSearchPageProps) {
  const bookId = Number((await params).id);
  if (!Number.isInteger(bookId) || bookId < 1) notFound();
  const [book, user, settings, queryParams, locale] = await Promise.all([
    getPostgresPublicNovel(database("web"), bookId),
    getCurrentUser(),
    readPostgresSiteSettings(),
    searchParams,
    getRequestLocale(),
  ]);
  if (!book || book.storageMode !== "chapters") notFound();
  if (!canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user))) notFound();
  const access = await checkPostgresContentAccess(database("web"), await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  const readAccess = await getPostgresNovelReadAccess(
    database("web"), book, user, settings.homePortalAccessModes.novels,
  );
  if (!access.allowed || !readAccess.allowed) notFound();

  const originalQuery = queryParams.q || "";
  const validation = validateSearchKeyword(await normalizeSearchText(originalQuery));
  const source = book.sourceId ? await getPostgresNovelSourceById(database("web"), book.sourceId) : null;
  const library = source?.slug || settings.defaultNovelLibrarySlug;
  const requestedPage = Math.max(Math.floor(Number(queryParams.page || 1)) || 1, 1);
  const [homeLabel, novelsLabel, bookSearchLabel, displayTitle, noResultsLabel] = await localizeTexts(
    ["首页", "小说", "本书搜索", book.title, "本书没有匹配内容。"] as const,
    locale,
  );
  const basePath = `/books/${book.id}/search`;

  return (
    <main className="appShell bookSearchPage">
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
        { label: displayTitle, href: `/books/${book.id}` },
        { label: bookSearchLabel },
      ]} />
      {validation.ok ? (
        <ContentSearchClient
          key={`${book.id}:${originalQuery}`}
          keyword={originalQuery}
          initialPage={requestedPage}
          highlightTerms={validation.query.highlightTerms}
          searchEventKey={null}
          searchSource="reader_current"
          originNovelId={book.id}
          library={library}
          novelId={book.id}
          resultReturnPath={basePath}
          resultReturnParams={{ q: originalQuery }}
          emptyMessage={noResultsLabel}
        />
      ) : (
        <section className="searchHero"><p className="searchMessage">{validation.message}</p></section>
      )}
    </main>
  );
}
