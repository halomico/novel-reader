import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import {
  normalizeSearchQuerySource,
  recordSearchQuery,
  resolveSearchQueryEventKey,
} from "@/lib/analytics";
import { canAccessNovelLibrary, getSearchResultsPageSize, shouldShowProgressBars } from "@/lib/config";
import { validateSearchKeyword } from "@/lib/search";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { checkContentAccess } from "@/lib/content-access";
import { getRequestLocale, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

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
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(user))) {
    notFound();
  }
  const access = checkContentAccess(await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const params = await searchParams;
  const originalQuery = params.q || "";
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
      <SiteHeader query={originalQuery} defaultSearchMode="content" currentUser={user} />
      <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: searchLabel }]} />
      {validation.ok ? (
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
        />
      ) : (
        <section className="searchHero">
          <p className="searchMessage">{validation.message}</p>
        </section>
      )}
    </main>
  );
}
