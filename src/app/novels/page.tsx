import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { CatalogRandomButton } from "@/components/CatalogRandomButton";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { NovelCatalogSort } from "@/components/NovelCatalogSort";
import { NovelSourcePicker } from "@/components/NovelSourcePicker";
import { PageContextBar } from "@/components/PageContextBar";
import { ResultCount } from "@/components/ResultCount";
import { Pagination } from "@/components/Pagination";
import { SearchEventUrlSync } from "@/components/SearchEventUrlSync";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import {
  normalizePostgresSearchQuerySource,
  recordPostgresSearchQuery,
  resolvePostgresSearchEventKey,
  updatePostgresSearchQueryResults,
} from "@/domains/analytics/postgres-search-analytics";
import {
  countPostgresCatalog,
  defaultPostgresCatalogSortOrder,
  listPostgresCatalogPage,
  listPostgresNovelSources,
  listPostgresRandomCatalog,
  normalizePostgresCatalogAccess,
  normalizePostgresCatalogSort,
  normalizePostgresCatalogSortOrder,
  resolvePostgresNovelLibraryScope,
  type PostgresPublicNovel,
} from "@/domains/catalog/postgres-catalog";
import {
  countPostgresAdvancedCatalog,
  searchPostgresCatalogTitles,
} from "@/domains/catalog/postgres-search";
import { canBrowseHomePortal, canConsumeHomePortal, isHomePortalEntryVisible } from "@/lib/home-portal";
import { getRequestLocale, localizeText, localizeTexts, normalizeSearchText } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import {
  DEFAULT_NOVEL_LIBRARY_SLUG,
  novelLibraryPreferenceCookieName,
} from "@/lib/novel-library-scope";
import { parseSimpleAndSearchQuery } from "@/lib/search-query";
import { canonicalPagePath, NO_INDEX_ROBOTS } from "@/lib/seo";
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
    library?: string;
    sourceLibrary?: string;
    sort?: string;
    order?: string;
    access?: string;
  }>;
};

export async function generateMetadata({ searchParams }: NovelsPageProps): Promise<Metadata> {
  const [locale, params, settings] = await Promise.all([
    getRequestLocale(),
    searchParams,
    readPostgresSiteSettings(),
  ]);
  const requestedLibrary = params.library || params.sourceLibrary || "";
  const sortBy = normalizePostgresCatalogSort(params.sort);
  const sortOrder = normalizePostgresCatalogSortOrder(params.order, sortBy);
  const isSearchOrRandom = Boolean(
    params.q?.trim() || params.random?.trim() || Number(params.page || 1) > 1 ||
    sortBy !== "updated" || sortOrder !== "desc" ||
    params.access === "free" || params.access === "soda" ||
    (requestedLibrary && requestedLibrary !== DEFAULT_NOVEL_LIBRARY_SLUG),
  );
  const portalMode = settings.homePortalAccessModes.novels;
  const isPublic = canConsumeHomePortal(portalMode, false);
  const canonicalPath = canonicalPagePath("/novels", 1);
  const canonical = withLocalePath(canonicalPath, locale);
  const sourceTitle = params.random?.trim() ? "随便看看" : params.q?.trim() ? "小说搜索" : "小说";
  const [title, description] = await localizeTexts([sourceTitle, "浏览并在线阅读站内小说。"] as const, locale);
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isPublic && !isSearchOrRandom ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: {
      title: !isSearchOrRandom ? await localizeText(settings.siteTitle || settings.siteName, locale) : title,
      description,
      url: canonical,
    },
  };
}

export default async function NovelsPage({ searchParams }: NovelsPageProps) {
  const [params, locale, user, settings, requestHeaders] = await Promise.all([
    searchParams,
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
    headers(),
  ]);
  const authenticated = Boolean(user);
  const portalMode = settings.homePortalAccessModes.novels;
  if (!canBrowseHomePortal(portalMode, authenticated)) {
    if (!user && isHomePortalEntryVisible(portalMode, false)) {
      const gateParams = new URLSearchParams();
      if (params.q) gateParams.set("q", params.q);
      if (params.library || params.sourceLibrary) gateParams.set("library", params.library || params.sourceLibrary || "");
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "小说")} returnTo={`/novels${gateParams.size ? `?${gateParams.toString()}` : ""}`} />;
    }
    notFound();
  }
  const requestedLibrary = params.library || params.sourceLibrary;
  const originalQuery = (params.q || "").trim();
  const [accessResult, cookieStore, normalizedQuery, allNovelSources] = await Promise.all([
    checkPostgresContentAccess(database("web"), requestHeaders, {
      scope: "novel",
      authenticated,
      admin: user?.role === "admin",
      rateLimit: false,
    }),
    !requestedLibrary && user ? cookies() : null,
    originalQuery ? normalizeSearchText(originalQuery) : "",
    listPostgresNovelSources(database("web"), { includeEmpty: true }),
  ]);
  if (!accessResult.allowed) notFound();

  const rememberedLibrary = user
    ? cookieStore?.get(novelLibraryPreferenceCookieName(user.id))?.value
    : undefined;
  const effectiveRequested = requestedLibrary || (
    rememberedLibrary && rememberedLibrary !== "default" && rememberedLibrary !== settings.defaultNovelLibrarySlug
      ? rememberedLibrary
      : undefined
  );
  const libraryScope = await resolvePostgresNovelLibraryScope(
    database("web"),
    effectiveRequested,
    settings.defaultNovelLibrarySlug,
  );
  const activeSource = libraryScope.kind === "source" ? libraryScope.source : null;
  const validation = normalizedQuery
    ? parseSimpleAndSearchQuery(normalizedQuery, { mode: "title" })
    : null;
  const pageSize = settings.catalogPageSize;
  const randomSeed = originalQuery ? "" : (params.random || "").trim();
  const sortBy = normalizePostgresCatalogSort(params.sort);
  const sortOrder = normalizePostgresCatalogSortOrder(params.order, sortBy);
  const access = normalizePostgresCatalogAccess(params.access);
  const rawPage = Math.floor(Number(params.page || 1));
  const currentPage = Number.isSafeInteger(rawPage) && rawPage > 0
    ? Math.min(rawPage, Math.floor(2_147_483_647 / pageSize) + 1)
    : 1;
  const offset = (currentPage - 1) * pageSize;

  let items: PostgresPublicNovel[] = [];
  let totalItems = 0;
  let message = "";
  if (validation && !validation.ok) {
    message = validation.message;
  } else if (randomSeed) {
    [items, totalItems] = await Promise.all([
      listPostgresRandomCatalog(database("web"), randomSeed, {
        sourceId: activeSource?.id,
        access,
        limit: pageSize,
      }),
      countPostgresCatalog(database("web"), { sourceId: activeSource?.id, access }),
    ]);
  } else if (validation?.ok) {
    const [page, total] = await Promise.all([
      searchPostgresCatalogTitles(database("web"), validation.query, {
        sourceId: activeSource?.id,
        access,
        limit: pageSize,
        offset,
        sortBy,
        sortOrder,
      }),
      countPostgresAdvancedCatalog(database("web"), validation.query, {
        sourceId: activeSource?.id,
        access,
        sortBy,
        sortOrder,
      }),
    ]);
    items = page.items.map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      sourceId: item.source_id,
      storageMode: item.storage_mode,
      chapterCount: item.chapter_count,
      accessMode: item.access_mode,
      sodaPrice: item.soda_price,
      previewChapterCount: 0,
      publishedContentVersion: null,
      sizeBytes: 0,
      mtimeMs: item.mtime_ms,
      wordCount: item.word_count,
      visitCount: 0,
      createdAt: item.updated_at,
      updatedAt: item.updated_at,
    }));
    totalItems = total;
  } else {
    const [page, total] = await Promise.all([
      listPostgresCatalogPage(database("web"), {
        sourceId: activeSource?.id,
        access,
        limit: pageSize,
        offset,
        sortBy,
        sortOrder,
      }),
      countPostgresCatalog(database("web"), { sourceId: activeSource?.id, access }),
    ]);
    items = page.items;
    totalItems = total;
  }
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const searchSource = normalizePostgresSearchQuerySource(params.source);
  const originNovelIdValue = Number(params.origin || 0);
  const originNovelId = Number.isSafeInteger(originNovelIdValue) && originNovelIdValue > 0 ? originNovelIdValue : null;
  let searchEventKey = validation?.ok && settings.analyticsEnabled
    ? await resolvePostgresSearchEventKey(database("web"), params.searchEvent, validation.keyword)
    : null;
  if (validation?.ok && settings.analyticsEnabled && !searchEventKey) {
    searchEventKey = await recordPostgresSearchQuery(database("web"), validation.keyword, "title", {
      source: searchSource,
      userId: user?.id ?? null,
      originNovelId,
      resultCount: totalItems,
      resultNovelCount: totalItems,
    });
  } else if (searchEventKey) {
    await updatePostgresSearchQueryResults(database("web"), searchEventKey, totalItems, totalItems);
  }

  const displayBooks = await Promise.all(items.map(async (book) => ({
    id: book.id,
    title: await localizeText(book.title, locale),
    storage_mode: book.storageMode,
    chapter_count: book.chapterCount,
    soda_price: book.sodaPrice,
    word_count: book.wordCount,
    mtime_ms: book.mtimeMs,
    updated_at: book.updatedAt,
  })));
  const novelSources = allNovelSources
    .filter((source) => source.slug === DEFAULT_NOVEL_LIBRARY_SLUG || source.novelCount > 0);
  const [homeLabel, novelsLabel, randomLabel] = await localizeTexts(["首页", "小说", "随便看看"] as const, locale);
  const baseParams = new URLSearchParams();
  if (originalQuery) baseParams.set("q", originalQuery);
  if (randomSeed) baseParams.set("random", randomSeed);
  if (libraryScope.slug !== settings.defaultNovelLibrarySlug) baseParams.set("library", libraryScope.slug);
  if (sortBy !== "updated") baseParams.set("sort", sortBy);
  if (sortOrder !== defaultPostgresCatalogSortOrder(sortBy)) baseParams.set("order", sortOrder);
  if (access !== "all") baseParams.set("access", access);
  if (searchSource !== "direct") baseParams.set("source", searchSource);
  if (originNovelId) baseParams.set("origin", String(originNovelId));
  if (searchEventKey) baseParams.set("searchEvent", searchEventKey);
  const returnParams = new URLSearchParams(baseParams);
  if (currentPage > 1) returnParams.set("page", String(currentPage));
  const returnHref = `/novels${returnParams.size ? `?${returnParams.toString()}` : ""}`;

  return (
    <main className="appShell catalogShell">
      <SearchEventUrlSync eventKey={searchEventKey} />
      <SiteHeader query={originalQuery} novelCatalogSearch currentUser={user} library={libraryScope.slug} />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: randomSeed ? randomLabel : novelsLabel }]}>
        <NovelSourcePicker
          sources={novelSources}
          activeSlug={libraryScope.slug}
          defaultSlug={settings.defaultNovelLibrarySlug}
          access={access}
          locale={locale}
          rememberForUserId={user?.id}
        />
        <NovelCatalogSort sortBy={sortBy} sortOrder={sortOrder} locale={locale} />
        {settings.randomCatalogEnabled && totalItems > 1 ? <CatalogRandomButton /> : null}
        <ResultCount count={totalItems} />
      </PageContextBar>

      {displayBooks.length ? (
        <CatalogBookGrid
          books={displayBooks}
          returnHref={returnHref}
          ariaLabel="小说列表"
          searchEventKey={searchEventKey}
          locale={locale}
        />
      ) : (
        <section className="emptyState"><h2>{message || "未找到匹配内容"}</h2></section>
      )}

      {!randomSeed && !message ? (
        <Pagination
          page={Math.min(currentPage, totalPages)}
          totalPages={totalPages}
          query={originalQuery}
          basePath="/novels"
          extraParams={Object.fromEntries(baseParams)}
        />
      ) : null}
    </main>
  );
}
