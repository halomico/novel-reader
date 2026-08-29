import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { CatalogRandomButton } from "@/components/CatalogRandomButton";
import { PageContextBar } from "@/components/PageContextBar";
import { Pagination } from "@/components/Pagination";
import { NovelCatalogSort } from "@/components/NovelCatalogSort";
import { NovelSourcePicker } from "@/components/NovelSourcePicker";
import { ResultCount } from "@/components/ResultCount";
import { SearchEventUrlSync } from "@/components/SearchEventUrlSync";
import { SiteHeader } from "@/components/SiteHeader";
import {
  normalizeSearchQuerySource,
  recordSearchQuery,
  resolveSearchQueryEventKey,
  updateSearchQueryResults,
} from "@/lib/analytics";
import {
  defaultNovelCatalogSortOrder,
  listNovels,
  normalizeNovelAccessFilter,
  normalizeNovelCatalogSort,
  normalizeNovelCatalogSortOrder,
} from "@/lib/books";
import {
  DEFAULT_NOVEL_LIBRARY_SLUG,
  listNovelSources,
  resolveNovelLibraryScope,
} from "@/lib/novel-library";
import { novelLibraryPreferenceCookieName } from "@/lib/novel-library-scope";
import {
  canAccessNovelLibrary,
  getCatalogPageSize,
  getDefaultNovelLibrarySlug,
  getSiteTitle,
  isGuestLibraryNavEnabled,
  isNovelLibraryPublic,
  isRandomCatalogEnabled,
  isTagLibraryEnabled,
  isTagLibraryPublic,
} from "@/lib/config";
import { canonicalPagePath, NO_INDEX_ROBOTS } from "@/lib/seo";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText, localizeTexts, normalizeSearchText } from "@/lib/locale-server";
import { filterTagsByNovelForUser } from "@/lib/tag-preferences";
import { listTagsForNovels, type Tag } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";
import { checkContentAccess } from "@/lib/content-access";

export const dynamic = "force-dynamic";

type NovelsPageProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    random?: string;
    source?: string;
    origin?: string;
    searchEvent?: string;
    library?: string;
    sourceLibrary?: string;
    sort?: string;
    order?: string;
    access?: string;
  }>;
};

export async function generateMetadata({ searchParams }: NovelsPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const params = await searchParams;
  const pageValue = Number(params.page || 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;
  const requestedLibrary = params.library || params.sourceLibrary || "";
  const sortBy = normalizeNovelCatalogSort(params.sort);
  const sortOrder = normalizeNovelCatalogSortOrder(params.order, sortBy);
  const isSearchOrRandom = Boolean(
    params.q?.trim() ||
    params.random?.trim() ||
    sortBy !== "updated" ||
    sortOrder !== "desc" ||
    params.access === "free" ||
    params.access === "soda" ||
    (requestedLibrary && requestedLibrary !== DEFAULT_NOVEL_LIBRARY_SLUG),
  );
  const isPublic = isNovelLibraryPublic();
  const canonicalPath = isSearchOrRandom ? "/novels" : canonicalPagePath("/novels", page);
  const canonical = withLocalePath(canonicalPath, locale);
  const sourceTitle = params.random?.trim()
    ? "随便看看"
    : params.q?.trim()
      ? "小说搜索"
      : page > 1
        ? `小说第 ${page} 页`
        : "小说";
  const [title, description] = await localizeTexts(
    [sourceTitle, "浏览并在线阅读站内小说。"] as const,
    locale,
  );
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isPublic && !isSearchOrRandom ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: {
      title: page === 1 && !isSearchOrRandom ? await localizeText(getSiteTitle(), locale) : title,
      description,
      url: canonical,
    },
  };
}

export default async function NovelsPage({ searchParams }: NovelsPageProps) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  if (!canAccessNovelLibrary(authenticated)) {
    if (!user && isGuestLibraryNavEnabled()) {
      const gateParams = new URLSearchParams();
      if (params.q) gateParams.set("q", params.q);
      if (params.page) gateParams.set("page", params.page);
      if (params.library || params.sourceLibrary) gateParams.set("library", params.library || params.sourceLibrary || "");
      const gateSort = normalizeNovelCatalogSort(params.sort);
      const gateOrder = normalizeNovelCatalogSortOrder(params.order, gateSort);
      if (gateSort !== "updated") gateParams.set("sort", gateSort);
      if (gateOrder !== defaultNovelCatalogSortOrder(gateSort)) gateParams.set("order", gateOrder);
      if (params.access === "free" || params.access === "soda") gateParams.set("access", params.access);
      const returnTo = `/novels${gateParams.size ? `?${gateParams.toString()}` : ""}`;
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "小说")} returnTo={returnTo} />;
    }
    notFound();
  }
  const access = checkContentAccess(await headers(), {
    scope: "novel",
    authenticated,
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const page = Number(params.page || "1");
  const query = params.q || "";
  const normalizedQuery = query ? await normalizeSearchText(query) : "";
  const pageSize = getCatalogPageSize();
  const requestedLibrary = params.library || params.sourceLibrary;
  const rememberedLibrary = !requestedLibrary && user
    ? (await cookies()).get(novelLibraryPreferenceCookieName(user.id))?.value
    : undefined;
  const libraryScope = resolveNovelLibraryScope(
    requestedLibrary || rememberedLibrary || getDefaultNovelLibrarySlug(),
  );
  const activeSource = libraryScope.kind === "source" ? libraryScope.source : null;
  const randomSeed = query ? "" : params.random || "";
  const sortBy = normalizeNovelCatalogSort(params.sort);
  const sortOrder = normalizeNovelCatalogSortOrder(params.order, sortBy);
  const accessFilter = normalizeNovelAccessFilter(params.access);
  const sourceResult = listNovels({
    page,
    q: normalizedQuery,
    pageSize,
    randomSeed,
    sourceId: activeSource?.id,
    sortBy,
    sortOrder,
    access: accessFilter,
  });
  const result = { ...sourceResult, query: query.trim() };
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
  const showTags = isTagLibraryEnabled() && (authenticated || isTagLibraryPublic());
  const tagAudience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const sourceTagsByNovel = showTags
    ? listTagsForNovels(result.books.map((book) => book.id), { audience: tagAudience })
    : new Map();
  const tagsByNovel = filterTagsByNovelForUser(sourceTagsByNovel, user?.id);
  const displayBooks = await Promise.all(result.books.map(async (book) => ({
    ...book,
    title: await localizeText(book.title, locale),
  })));
  const displayTagsByNovel = new Map<number, Tag[]>();
  for (const [novelId, tags] of tagsByNovel) {
    displayTagsByNovel.set(
      novelId,
      await Promise.all(tags.map(async (tag) => ({
        ...tag,
        name: await localizeText(tag.name, locale),
      }))),
    );
  }
  const [homeLabel, novelsLabel, randomLabel] = await localizeTexts(
    ["首页", "小说", "随便看看"] as const,
    locale,
  );
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
  if (libraryScope.slug !== DEFAULT_NOVEL_LIBRARY_SLUG) returnParams.set("library", libraryScope.slug);
  if (sortBy !== "updated") returnParams.set("sort", sortBy);
  if (sortOrder !== defaultNovelCatalogSortOrder(sortBy)) returnParams.set("order", sortOrder);
  if (accessFilter !== "all") returnParams.set("access", accessFilter);
  const returnHref = `/novels?${returnParams.toString()}`;
  const novelSources = listNovelSources({ includeEmpty: true })
    .filter((source) => source.slug === DEFAULT_NOVEL_LIBRARY_SLUG || source.novelCount > 0);

  return (
    <main className="appShell catalogShell">
      <SearchEventUrlSync eventKey={searchEventKey} />
      <SiteHeader query={result.query} novelCatalogSearch currentUser={user} library={libraryScope.slug} />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: randomSeed ? randomLabel : novelsLabel }]}>
        <NovelSourcePicker
          sources={novelSources}
          activeSlug={libraryScope.slug}
          access={accessFilter}
          locale={locale}
          rememberForUserId={user?.id}
        />
        <NovelCatalogSort sortBy={sortBy} sortOrder={sortOrder} locale={locale} />
        {isRandomCatalogEnabled() && result.totalBooks > 1 ? <CatalogRandomButton /> : null}
        <ResultCount count={result.totalBooks} />
      </PageContextBar>

      {result.books.length > 0 ? (
        <CatalogBookGrid
          books={displayBooks}
          returnHref={returnHref}
          ariaLabel="小说列表"
          tagsByNovel={displayTagsByNovel}
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
        extraParams={{
          library: libraryScope.slug === DEFAULT_NOVEL_LIBRARY_SLUG ? undefined : libraryScope.slug,
          sort: sortBy === "updated" ? undefined : sortBy,
          order: sortOrder === defaultNovelCatalogSortOrder(sortBy) ? undefined : sortOrder,
          access: accessFilter === "all" ? undefined : accessFilter,
          source: searchSource === "direct" ? undefined : searchSource,
          origin: Number.isInteger(originNovelId) && originNovelId > 0 ? String(originNovelId) : undefined,
          searchEvent: searchEventKey || undefined,
        }}
      />
    </main>
  );
}
