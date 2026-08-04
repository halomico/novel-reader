import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import {
  normalizeSearchQuerySource,
  recordSearchQuery,
  resolveSearchQueryEventKey,
} from "@/lib/analytics";
import { canAccessNovelLibrary, getSearchResultsPageSize, isGuestLibraryNavEnabled, shouldShowProgressBars } from "@/lib/config";
import { validateSearchKeyword } from "@/lib/search";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { checkContentAccess } from "@/lib/content-access";
import { getRequestLocale, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { DEFAULT_NOVEL_LIBRARY_SLUG, resolveNovelLibraryScope } from "@/lib/novel-library";
import { isNovelSourceFullTextSearchEnabled } from "@/lib/novel-search-policy";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: uiText(locale, "全文搜索"),
    robots: NO_INDEX_ROBOTS,
    alternates: {
      canonical: withLocalePath("/search", locale),
      languages: languageAlternates("/search"),
    },
  };
}

type SearchPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    source?: string;
    origin?: string;
    searchEvent?: string;
    library?: string;
    sourceLibrary?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const params = await searchParams;
  if (!canAccessNovelLibrary(Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      const gateParams = new URLSearchParams();
      if (params.q) gateParams.set("q", params.q);
      if (params.library || params.sourceLibrary) gateParams.set("library", params.library || params.sourceLibrary || "");
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "全文搜索")} returnTo={`/search${gateParams.size ? `?${gateParams.toString()}` : ""}`} />;
    }
    notFound();
  }
  const access = checkContentAccess(await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const originalQuery = params.q || "";
  const libraryScope = resolveNovelLibraryScope(params.library || params.sourceLibrary);
  const fullTextSearchEnabled = libraryScope.kind === "all" || isNovelSourceFullTextSearchEnabled(libraryScope.source.slug);
  const validation = validateSearchKeyword(originalQuery);
  const pageSize = getSearchResultsPageSize();
  const hasExplicitPage = Boolean(params.page);
  const source = normalizeSearchQuerySource(params.source);
  const originNovelId = Number(params.origin || 0);
  let searchEventKey = validation.ok ? resolveSearchQueryEventKey(params.searchEvent, validation.keyword) : null;
  if (validation.ok && !searchEventKey) {
    searchEventKey = recordSearchQuery(originalQuery, "content", {
      source,
      userId: user?.id ?? null,
      originNovelId,
    });
  }
  const pageValue = Number(params.page || 1);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;
  const [homeLabel, searchLabel] = await localizeTexts(
    ["首页", "全文搜索"] as const,
    locale,
  );

  return (
    <main className="appShell">
      <SiteHeader query={originalQuery} defaultSearchMode="content" currentUser={user} library={libraryScope.slug} />
      <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: searchLabel }]} />
      {!fullTextSearchEnabled ? (
        <section className="searchHero">
          <p className="searchMessage">{uiText(locale, "该书库未加入全站正文索引，请进入具体书籍后使用“本书”搜索。")}</p>
        </section>
      ) : validation.ok ? (
        <ContentSearchClient
          keyword={originalQuery}
          initialPage={page}
          hasExplicitPage={hasExplicitPage}
          pageSize={pageSize}
          highlightTerms={validation.query.highlightTerms}
          showProgressBars={shouldShowProgressBars()}
          searchEventKey={searchEventKey}
          searchSource={source}
          originNovelId={Number.isInteger(originNovelId) && originNovelId > 0 ? originNovelId : null}
          library={libraryScope.slug}
          resultReturnParams={libraryScope.slug === DEFAULT_NOVEL_LIBRARY_SLUG ? {} : { library: libraryScope.slug }}
        />
      ) : (
        <section className="searchHero">
          <p className="searchMessage">{validation.message}</p>
        </section>
      )}
    </main>
  );
}
