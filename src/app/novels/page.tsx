import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { CatalogRandomButton } from "@/components/CatalogRandomButton";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SearchEventUrlSync } from "@/components/SearchEventUrlSync";
import { SiteHeader } from "@/components/SiteHeader";
import {
  normalizeSearchQuerySource,
  recordSearchQuery,
  resolveSearchQueryEventKey,
  updateSearchQueryResults,
} from "@/lib/analytics";
import { getAdminSession } from "@/lib/admin-auth";
import { listNovels } from "@/lib/books";
import {
  canAccessNovelLibrary,
  getCatalogPageSize,
  getSiteTitle,
  isGuestTagLibraryNavEnabled,
  isNovelLibraryPublic,
  isRandomCatalogEnabled,
  isTagLibraryEnabled,
} from "@/lib/config";
import { canonicalPagePath, NO_INDEX_ROBOTS } from "@/lib/seo";
import { listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type NovelsPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    random?: string;
    source?: string;
    origin?: string;
    searchEvent?: string;
  }>;
};

export async function generateMetadata({ searchParams }: NovelsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const pageValue = Number(params.page || 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;
  const isSearchOrRandom = Boolean(params.q?.trim() || params.random?.trim());
  const isPublic = isNovelLibraryPublic();
  const canonical = isSearchOrRandom ? "/novels" : canonicalPagePath("/novels", page);
  const title = params.random?.trim()
    ? "随便看看"
    : params.q?.trim()
      ? "小说搜索"
      : page > 1
        ? `小说第 ${page} 页`
        : "小说";
  return {
    title,
    description: "浏览并在线阅读站内小说。",
    alternates: { canonical },
    robots: isPublic && !isSearchOrRandom ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: {
      title: page === 1 && !isSearchOrRandom ? getSiteTitle() : title,
      description: "浏览并在线阅读站内小说。",
      url: canonical,
    },
  };
}

export default async function NovelsPage({ searchParams }: NovelsPageProps) {
  const params = await searchParams;
  const [user, adminSession] = await Promise.all([getCurrentUser(), getAdminSession()]);
  const authenticated = Boolean(user || adminSession);
  if (!adminSession && !canAccessNovelLibrary(Boolean(user))) {
    notFound();
  }
  const page = Number(params.page || "1");
  const query = params.q || "";
  const pageSize = getCatalogPageSize();
  const randomSeed = query ? "" : params.random || "";
  const result = listNovels({ page, q: query, pageSize, randomSeed });
  const searchSource = normalizeSearchQuerySource(params.source);
  const originNovelId = Number(params.origin || 0);
  let searchEventKey = result.query ? resolveSearchQueryEventKey(params.searchEvent, result.query) : null;
  if (result.query && !searchEventKey) {
    searchEventKey = recordSearchQuery(result.query, "title", {
      source: searchSource,
      userId: user?.id ?? null,
      originNovelId,
      resultCount: result.totalBooks,
      resultNovelCount: result.totalBooks,
    });
  } else if (searchEventKey) {
    updateSearchQueryResults(searchEventKey, result.totalBooks, result.totalBooks);
  }
  const showTags = isTagLibraryEnabled() && (authenticated || isGuestTagLibraryNavEnabled());
  const tagsByNovel = showTags ? listTagsForNovels(result.books.map((book) => book.id)) : new Map();
  const returnParams = new URLSearchParams();
  returnParams.set("page", String(result.page));
  if (result.query) {
    returnParams.set("q", result.query);
    if (searchSource !== "direct") returnParams.set("source", searchSource);
    if (Number.isInteger(originNovelId) && originNovelId > 0) returnParams.set("origin", String(originNovelId));
    if (searchEventKey) returnParams.set("searchEvent", searchEventKey);
  }
  if (randomSeed) {
    returnParams.set("random", randomSeed);
  }
  const returnHref = `/novels?${returnParams.toString()}`;

  return (
    <main className="appShell catalogShell">
      <SearchEventUrlSync eventKey={searchEventKey} />
      <SiteHeader query={result.query} defaultSearchExpanded currentUser={user} />
      <section className="catalogToolbar">
        <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: randomSeed ? "随便看看" : "小说" }]} />
        <div className="catalogSummary">
          {isRandomCatalogEnabled() && result.totalBooks > 1 ? <CatalogRandomButton /> : null}
          <ResultCount count={result.totalBooks} />
        </div>
      </section>

      {result.books.length > 0 ? (
        <CatalogBookGrid
          books={result.books}
          returnHref={returnHref}
          ariaLabel="小说列表"
          tagsByNovel={tagsByNovel}
          searchEventKey={searchEventKey}
        />
      ) : (
        <section className="emptyState">
          <h2>{result.message || "未找到匹配内容"}</h2>
        </section>
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        query={result.query}
        basePath="/novels"
        extraParams={result.query ? {
          source: searchSource === "direct" ? undefined : searchSource,
          origin: Number.isInteger(originNovelId) && originNovelId > 0 ? String(originNovelId) : undefined,
          searchEvent: searchEventKey || undefined,
        } : undefined}
      />
    </main>
  );
}
