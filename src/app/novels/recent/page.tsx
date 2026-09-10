import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { PageContextBar } from "@/components/PageContextBar";
import { ResultCount } from "@/components/ResultCount";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import {
  countPostgresCatalog,
  listPostgresCatalogPage,
} from "@/domains/catalog/postgres-catalog";
import { isGuestLibraryNavEnabled } from "@/lib/config";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { getCurrentUser } from "@/lib/user-auth";
import { ALL_NOVEL_LIBRARIES_SLUG } from "@/lib/novel-library-scope";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "最近更新", robots: { index: false, follow: true } };

export default async function RecentNovelsPage({ searchParams }: {
  searchParams: Promise<{ page?: string }>;
}) {
  const [query, locale, user, settings, requestHeaders] = await Promise.all([
    searchParams,
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
    headers(),
  ]);
  if (!canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label="最近更新" returnTo="/novels/recent" />;
    }
    notFound();
  }
  const access = await checkPostgresContentAccess(database("web"), requestHeaders, {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const rawPage = Math.floor(Number(query.page || 1));
  const currentPage = Number.isSafeInteger(rawPage) && rawPage > 0
    ? Math.min(rawPage, Math.floor(2_147_483_647 / settings.catalogPageSize) + 1)
    : 1;
  const [result, totalBooks] = await Promise.all([
    listPostgresCatalogPage(database("web"), {
      limit: settings.catalogPageSize,
      offset: (currentPage - 1) * settings.catalogPageSize,
      sortBy: "updated",
      sortOrder: "desc",
    }),
    countPostgresCatalog(database("web")),
  ]);
  const books = await Promise.all(result.items.map(async (book) => ({
    id: book.id,
    title: await localizeText(book.title, locale),
    storage_mode: book.storageMode,
    chapter_count: book.chapterCount,
    soda_price: book.sodaPrice,
    word_count: book.wordCount,
    mtime_ms: book.mtimeMs,
    updated_at: book.updatedAt,
  })));
  const totalPages = Math.max(1, Math.ceil(totalBooks / settings.catalogPageSize));
  const returnHref = `/novels/recent${currentPage > 1 ? `?page=${currentPage}` : ""}`;
  const [homeLabel, novelsLabel, recentLabel] = await localizeTexts(["首页", "小说", "最近更新"] as const, locale);

  return (
    <main className="appShell catalogShell recentNovelsShell">
      <SiteHeader currentUser={user} library={ALL_NOVEL_LIBRARIES_SLUG} novelCatalogSearch />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: novelsLabel, href: "/novels" }, { label: recentLabel }]}>
        <ResultCount count={totalBooks} />
      </PageContextBar>
      {books.length
        ? <CatalogBookGrid books={books} returnHref={returnHref} ariaLabel="最近更新小说" locale={locale} />
        : <section className="emptyState"><h2>暂无小说</h2></section>}
      <Pagination page={Math.min(currentPage, totalPages)} totalPages={totalPages} query="" basePath="/novels/recent" />
    </main>
  );
}
