import { ContentSearchClient } from "@/components/ContentSearchClient";
import { SiteHeader } from "@/components/SiteHeader";
import { recordSearchQuery } from "@/lib/analytics";
import { getGlobalSearchMaxResults, getSearchResultsPageSize, shouldShowProgressBars } from "@/lib/config";
import { validateSearchKeyword } from "@/lib/search";

export const dynamic = "force-dynamic";

type SearchPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
  }>;
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const validation = validateSearchKeyword(params.q);
  const pageSize = getSearchResultsPageSize();
  const maxResults = getGlobalSearchMaxResults();
  const hasExplicitPage = Boolean(params.page);
  if (validation.ok && !hasExplicitPage) {
    recordSearchQuery(validation.keyword, "content");
  }
  const pageValue = Number(params.page || 1);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;

  return (
    <main className="appShell">
      <SiteHeader query={validation.keyword} defaultSearchMode="content" />
      {validation.ok ? (
        <ContentSearchClient
          keyword={validation.keyword}
          initialPage={page}
          hasExplicitPage={hasExplicitPage}
          pageSize={pageSize}
          maxResults={maxResults}
          highlightTerms={validation.query.highlightTerms}
          showProgressBars={shouldShowProgressBars()}
        />
      ) : (
        <section className="searchHero">
          <p className="searchMessage">{validation.message}</p>
        </section>
      )}
    </main>
  );
}
