import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import {
  normalizeSearchQuerySource,
  recordSearchQuery,
  resolveSearchQueryEventKey,
} from "@/lib/analytics";
import { getAdminSession } from "@/lib/admin-auth";
import { canAccessNovelLibrary, getSearchResultsPageSize, shouldShowProgressBars } from "@/lib/config";
import { validateSearchKeyword } from "@/lib/search";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "全文搜索", robots: NO_INDEX_ROBOTS };

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
  const [user, adminSession] = await Promise.all([getCurrentUser(), getAdminSession()]);
  if (!adminSession && !canAccessNovelLibrary(Boolean(user))) {
    notFound();
  }
  const params = await searchParams;
  const validation = validateSearchKeyword(params.q);
  const pageSize = getSearchResultsPageSize();
  const hasExplicitPage = Boolean(params.page);
  const source = normalizeSearchQuerySource(params.source);
  const originNovelId = Number(params.origin || 0);
  let searchEventKey = validation.ok ? resolveSearchQueryEventKey(params.searchEvent, validation.keyword) : null;
  if (validation.ok && !searchEventKey) {
    searchEventKey = recordSearchQuery(validation.keyword, "content", {
      source,
      userId: user?.id ?? null,
      originNovelId,
    });
  }
  const pageValue = Number(params.page || 1);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;

  return (
    <main className="appShell">
      <SiteHeader query={validation.keyword} defaultSearchMode="content" currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "全文搜索" }]} />
      {validation.ok ? (
        <ContentSearchClient
          keyword={validation.keyword}
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
