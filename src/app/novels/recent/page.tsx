import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { PageContextBar } from "@/components/PageContextBar";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SiteHeader } from "@/components/SiteHeader";
import { listRecentlyUpdatedNovels } from "@/lib/books";
import { canAccessNovelLibrary, getCatalogPageSize, isGuestLibraryNavEnabled } from "@/lib/config";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { getCurrentUser } from "@/lib/user-auth";
import { ALL_NOVEL_LIBRARIES_SLUG } from "@/lib/novel-library-scope";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "最近更新", robots: { index: false, follow: true } };

export default async function RecentNovelsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const query = await searchParams;
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label="最近更新" returnTo="/novels/recent" />;
    }
    notFound();
  }
  const result = listRecentlyUpdatedNovels({
    page: Number(query.page || 1),
    pageSize: getCatalogPageSize(),
  });
  const books = await Promise.all(result.books.map(async (book) => ({ ...book, title: await localizeText(book.title, locale) })));
  const [homeLabel, novelsLabel, recentLabel] = await localizeTexts(["首页", "小说", "最近更新"] as const, locale);
  const returnParams = new URLSearchParams({ page: String(result.page) });
  const returnHref = `/novels/recent?${returnParams}`;

  return (
    <main className="appShell catalogShell recentNovelsShell">
      <SiteHeader currentUser={user} library={ALL_NOVEL_LIBRARIES_SLUG} novelCatalogSearch />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: novelsLabel, href: "/novels" }, { label: recentLabel }]}>
        <ResultCount count={result.totalBooks} />
      </PageContextBar>
      {books.length ? <CatalogBookGrid books={books} returnHref={returnHref} ariaLabel="最近更新小说" locale={locale} /> : <section className="emptyState"><h2>暂无小说</h2></section>}
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        query=""
        basePath="/novels/recent"
      />
    </main>
  );
}
