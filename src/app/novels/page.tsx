import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { CatalogRandomButton } from "@/components/CatalogRandomButton";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { recordSearchQuery } from "@/lib/analytics";
import { listNovels } from "@/lib/books";
import { getCatalogPageSize, getSiteTitle, isGuestTagLibraryNavEnabled, isRandomCatalogEnabled, isTagLibraryEnabled } from "@/lib/config";
import { canonicalPagePath, NO_INDEX_ROBOTS } from "@/lib/seo";
import { listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type NovelsPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    random?: string;
  }>;
};

export async function generateMetadata({ searchParams }: NovelsPageProps): Promise<Metadata> {
  const params = await searchParams;
  const pageValue = Number(params.page || 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;
  const isSearchOrRandom = Boolean(params.q?.trim() || params.random?.trim());
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
    robots: isSearchOrRandom ? NO_INDEX_ROBOTS : { index: true, follow: true },
    openGraph: {
      title: page === 1 && !isSearchOrRandom ? getSiteTitle() : title,
      description: "浏览并在线阅读站内小说。",
      url: canonical,
    },
  };
}

export default async function NovelsPage({ searchParams }: NovelsPageProps) {
  const params = await searchParams;
  const page = Number(params.page || "1");
  const query = params.q || "";
  const pageSize = getCatalogPageSize();
  const randomSeed = query ? "" : params.random || "";
  const result = listNovels({ page, q: query, pageSize, randomSeed });
  const user = await getCurrentUser();
  const showTags = isTagLibraryEnabled() && (Boolean(user) || isGuestTagLibraryNavEnabled());
  const tagsByNovel = showTags ? listTagsForNovels(result.books.map((book) => book.id)) : new Map();
  if (result.query && !params.page) {
    recordSearchQuery(result.query, "title");
  }
  const returnParams = new URLSearchParams();
  returnParams.set("page", String(result.page));
  if (result.query) {
    returnParams.set("q", result.query);
  }
  if (randomSeed) {
    returnParams.set("random", randomSeed);
  }
  const returnHref = `/novels?${returnParams.toString()}`;

  return (
    <main className="appShell catalogShell">
      <SiteHeader query={result.query} defaultSearchExpanded currentUser={user} />
      <section className="catalogToolbar">
        <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: randomSeed ? "随便看看" : "小说" }]} />
        <div className="catalogSummary">
          {isRandomCatalogEnabled() && result.totalBooks > 1 ? <CatalogRandomButton /> : null}
          <p>
            共 <strong>{result.totalBooks}</strong> 本
          </p>
        </div>
      </section>

      {result.books.length > 0 ? (
        <CatalogBookGrid books={result.books} returnHref={returnHref} ariaLabel="小说列表" tagsByNovel={tagsByNovel} />
      ) : (
        <section className="emptyState">
          <h2>{result.message || "未找到匹配内容"}</h2>
        </section>
      )}

      <Pagination page={result.page} totalPages={result.totalPages} query={result.query} basePath="/novels" />
    </main>
  );
}
