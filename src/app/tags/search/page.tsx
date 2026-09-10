import { Filter } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdvancedSearchResultAnchor } from "@/components/AdvancedSearchResultAnchor";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { OriginalAdvancedSearchResults } from "@/components/OriginalAdvancedSearchResults";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { TagIntersectionSearchForm, type AdvancedTagGroup } from "@/components/TagIntersectionSearchForm";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { listPostgresNovelSources, type PostgresPublicNovelSource } from "@/domains/catalog/postgres-catalog";
import {
  countPostgresAdvancedCatalog,
  listPostgresCatalogSearchTagGroups,
  searchPostgresAdvancedCatalog,
} from "@/domains/catalog/postgres-search";
import { hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import {
  recordPostgresSearchQuery,
  resolvePostgresSearchEventKey,
} from "@/domains/analytics/postgres-search-analytics";
import {
  countPostgresOriginalArticles,
  listPostgresOriginalSearchTags,
  searchPostgresOriginalArticles,
} from "@/domains/originals/postgres-search";
import { parseSimpleAndSearchQuery, validateSearchKeyword } from "@/lib/search-query";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { ALL_NOVEL_LIBRARIES_SLUG, DEFAULT_NOVEL_LIBRARY_SLUG } from "@/lib/novel-library-scope";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: uiText(locale, "高级搜索"),
    robots: NO_INDEX_ROBOTS,
    alternates: {
      canonical: withLocalePath("/tags/search", locale),
      languages: languageAlternates("/tags/search"),
    },
  };
}

type AdvancedTagSearchPageProps = {
  searchParams: Promise<{
    tags?: string;
    exclude?: string;
    q?: string;
    content?: string;
    page?: string;
    searchEvent?: string;
    library?: string;
    sourceLibrary?: string;
    scope?: string;
    cursor?: string;
    trail?: string;
  }>;
};

function resolveLibraryScope(
  sources: readonly PostgresPublicNovelSource[],
  requestedValue: string | undefined,
  configuredDefault: string,
): { slug: string; source: PostgresPublicNovelSource | null } {
  const requested = String(requestedValue || configuredDefault).normalize("NFKC").trim()
    .toLocaleLowerCase("en-US").slice(0, 64);
  if (requested === ALL_NOVEL_LIBRARIES_SLUG) return { slug: ALL_NOVEL_LIBRARIES_SLUG, source: null };
  const bySlug = new Map(sources.map((source) => [source.slug.toLocaleLowerCase("en-US"), source]));
  const source = bySlug.get(requested) ?? bySlug.get(configuredDefault) ?? bySlug.get(DEFAULT_NOVEL_LIBRARY_SLUG);
  if (!source) throw new Error("PostgreSQL default novel library is not initialized");
  return { slug: source.slug, source };
}

export default async function AdvancedTagSearchPage({ searchParams }: AdvancedTagSearchPageProps) {
  const [params, locale, user, settings] = await Promise.all([
    searchParams,
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
  ]);
  const advancedEnabled = settings.advancedTagSearchEnabled &&
    canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user)) &&
    canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user));
  const guestAdvancedEnabled = settings.advancedTagSearchEnabled && settings.guestAdvancedTagSearchEnabled &&
    canBrowseHomePortal(settings.homePortalAccessModes.novels, false) &&
    canBrowseHomePortal(settings.homePortalAccessModes.tags, false);
  const canUseAdvancedSearch = guestAdvancedEnabled || (advancedEnabled &&
    await hasPostgresUserPermission(database("web"), user, "advanced_search"));
  if (!canUseAdvancedSearch) notFound();
  const originalSearchEnabled = settings.originalChannelEnabled &&
    canBrowseHomePortal(settings.homePortalAccessModes.original, Boolean(user));
  const searchScope = params.scope === "originals" && originalSearchEnabled ? "originals" : "novels";
  if (params.scope === "originals" && !originalSearchEnabled) notFound();

  if (searchScope === "originals") {
    const viewer = user ? { id: user.id, role: user.role } as const : null;
    const rawTags = await listPostgresOriginalSearchTags(database("web"), viewer);
    const localizedTags = await Promise.all(rawTags.map(async (tag) => ({
      ...tag,
      name: await localizeText(tag.name, locale),
      aliases: [] as string[],
    })));
    const groups: AdvancedTagGroup[] = localizedTags.length ? [{ label: uiText(locale, "文章标签"), tags: localizedTags }] : [];
    const tagBySlug = new Map(localizedTags.map((tag) => [tag.slug, tag]));
    const selectedSlugs = Array.from(new Set((params.tags || "").split(",").map((slug) => slug.trim()).filter((slug) => tagBySlug.has(slug)))).slice(0, 20);
    const excludedSlugs = Array.from(new Set((params.exclude || "").split(",").map((slug) => slug.trim()).filter((slug) => tagBySlug.has(slug) && !selectedSlugs.includes(slug)))).slice(0, 20);
    const titleInput = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
    const contentInput = (params.content || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 200);
    const titleValidation = titleInput ? parseSimpleAndSearchQuery(titleInput, { mode: "title" }) : null;
    const contentValidation = contentInput ? parseSimpleAndSearchQuery(contentInput, { mode: "content" }) : null;
    const hasFilters = Boolean(titleInput || contentInput || selectedSlugs.length || excludedSlugs.length);
    const validFilters = (!titleValidation || titleValidation.ok) && (!contentValidation || contentValidation.ok);
    const originalPageSize = settings.searchResultsPageSize || 20;
    const rawPage = Math.floor(Number(params.page || 1));
    const currentPage = Number.isSafeInteger(rawPage) && rawPage > 0
      ? Math.min(rawPage, Math.floor(2_147_483_647 / originalPageSize) + 1)
      : 1;
    const originalSearchOptions = {
      viewer,
      titleQuery: titleValidation?.ok ? titleValidation.query : undefined,
      contentQuery: contentValidation?.ok ? contentValidation.query : undefined,
      includeTagSlugs: selectedSlugs,
      excludeTagSlugs: excludedSlugs,
    } as const;
    const [result, totalItems] = hasFilters && validFilters
      ? await Promise.all([
          searchPostgresOriginalArticles(database("web"), {
            ...originalSearchOptions,
            offset: (currentPage - 1) * originalPageSize,
            limit: originalPageSize,
          }),
          countPostgresOriginalArticles(database("web"), originalSearchOptions),
        ])
      : [null, 0] as const;
    const items = result ? await Promise.all(result.items.map(async (article) => ({
      ...article,
      title: await localizeText(article.title, locale),
      authorName: await localizeText(article.authorName, locale),
      tags: await Promise.all(article.tags.map(async (tag) => ({ ...tag, name: await localizeText(tag.name, locale) }))),
    }))) : [];
    const baseParams = new URLSearchParams({ scope: "originals" });
    if (selectedSlugs.length) baseParams.set("tags", selectedSlugs.join(","));
    if (excludedSlugs.length) baseParams.set("exclude", excludedSlugs.join(","));
    if (titleInput) baseParams.set("q", titleInput);
    if (contentInput) baseParams.set("content", contentInput);
    const paginationParams = Object.fromEntries(baseParams);
    const returnParams = new URLSearchParams(baseParams);
    if (currentPage > 1) returnParams.set("page", String(currentPage));
    const invalidMessage = titleValidation && !titleValidation.ok
      ? titleValidation.message
      : contentValidation && !contentValidation.ok ? contentValidation.message : null;
    const returnHref = `/tags/search?${returnParams.toString()}`;
    const totalPages = Math.max(1, Math.ceil(totalItems / originalPageSize));
    const [homeLabel, tagsLabel, advancedLabel, noResultsLabel] = await localizeTexts(
      ["首页", "标签", "高级搜索", "没有符合条件的文章"] as const,
      locale,
    );

    return (
      <main className="appShell catalogShell advancedTagSearchPage">
        <SiteHeader currentUser={user} />
        <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: tagsLabel, href: "/tags" }, { label: advancedLabel }]} />
        <header className="advancedTagSearchHeader userContentHeader">
          <span><Filter size={19} aria-hidden="true" /><h1>{advancedLabel}</h1></span>
        </header>
        <TagIntersectionSearchForm
          groups={groups}
          initialSelected={selectedSlugs}
          initialExcluded={excludedSlugs}
          initialTitleQuery={titleInput}
          initialContentQuery={contentInput}
          sources={[]}
          initialSourceLibrary={DEFAULT_NOVEL_LIBRARY_SLUG}
          initialScope="originals"
          originalSearchEnabled={originalSearchEnabled}
          locale={locale}
        />
        <AdvancedSearchResultAnchor count={result?.items.length} scrollKey={`${returnHref}:${currentPage}`} />
        {invalidMessage ? (
          <section className="emptyState"><h2>{invalidMessage}</h2></section>
        ) : result ? items.length ? (
          <OriginalAdvancedSearchResults
            items={items}
            locale={locale}
            page={currentPage}
            totalPages={totalPages}
            paginationParams={paginationParams}
          />
        ) : (
          <section className="emptyState"><h2>{noResultsLabel}</h2></section>
        ) : null}
      </main>
    );
  }
  const headerStore = await headers();
  const [access, allNovelSources] = await Promise.all([
    checkPostgresContentAccess(database("web"), headerStore, {
      scope: "novel",
      authenticated: Boolean(user),
      admin: user?.role === "admin",
      rateLimit: false,
    }),
    listPostgresNovelSources(database("web"), { includeEmpty: true }),
  ]);
  if (!access.allowed) notFound();

  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const novelSources = allNovelSources
    .filter((source) => source.slug === DEFAULT_NOVEL_LIBRARY_SLUG || source.novelCount > 0);
  const localizedNovelSources = await Promise.all(novelSources.map(async (source) => ({
    ...source,
    // Source names are stored content, not UI keys; localize them explicitly
    // so the traditional advanced-search picker cannot leak simplified text.
    name: await localizeText(source.name, locale),
  })));
  const libraryScope = resolveLibraryScope(
    allNovelSources,
    params.library || params.sourceLibrary,
    settings.defaultNovelLibrarySlug,
  );
  const activeSource = libraryScope.source;
  const sourceAdvancedGroups = await listPostgresCatalogSearchTagGroups(database("web"), {
    audience,
    sourceId: activeSource?.id,
    userId: user?.id,
  });
  const groups: AdvancedTagGroup[] = await Promise.all(
    sourceAdvancedGroups.map(async (group) => ({
      ...group,
      label: await localizeText(group.label, locale),
      tags: await Promise.all(group.tags.map(async (tag) => ({
        ...tag,
        name: await localizeText(tag.name, locale),
        aliases: await Promise.all(tag.aliases.map((alias) => localizeText(alias, locale))),
      }))),
    })),
  );
  const tagBySlug = new Map(groups.flatMap((group) => group.tags).map((tag) => [tag.slug, tag]));
  const selectedSlugs = Array.from(new Set((params.tags || "").split(",").map((slug) => slug.trim()).filter((slug) => tagBySlug.has(slug)))).slice(0, 20);
  const excludedSlugs = Array.from(new Set((params.exclude || "").split(",").map((slug) => slug.trim()).filter((slug) => tagBySlug.has(slug) && !selectedSlugs.includes(slug)))).slice(0, 20);
  const titleInput = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const titleValidation = titleInput ? parseSimpleAndSearchQuery(titleInput, { mode: "title" }) : null;
  const contentInput = (params.content || "").trim();
  const contentValidation = contentInput ? validateSearchKeyword(contentInput) : null;
  const pageSize = settings.catalogPageSize || 15;
  const pageValue = Math.floor(Number(params.page || 1));
  const page = Number.isSafeInteger(pageValue) && pageValue > 0
    ? Math.min(pageValue, Math.floor(2_147_483_647 / pageSize) + 1)
    : 1;
  const catalogSearchOptions = {
    includeTagSlugs: selectedSlugs,
    excludeTagSlugs: excludedSlugs,
    audience,
    sourceId: activeSource?.id,
  } as const;
  const canRunCatalogSearch = (!titleValidation || titleValidation.ok) &&
    (selectedSlugs.length > 0 || Boolean(titleInput) || Boolean(activeSource)) && !contentInput;
  const [result, totalCatalogItems] = canRunCatalogSearch
    ? await Promise.all([
        searchPostgresAdvancedCatalog(database("web"), titleValidation?.ok ? titleValidation.query : undefined, {
          ...catalogSearchOptions,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
        countPostgresAdvancedCatalog(
          database("web"),
          titleValidation?.ok ? titleValidation.query : undefined,
          catalogSearchOptions,
        ),
      ])
    : [null, 0] as const;
  const returnParams = new URLSearchParams();
  if (selectedSlugs.length) returnParams.set("tags", selectedSlugs.join(","));
  if (excludedSlugs.length) returnParams.set("exclude", excludedSlugs.join(","));
  if (titleInput) returnParams.set("q", titleInput);
  if (contentInput) returnParams.set("content", contentInput);
  if (libraryScope.slug !== settings.defaultNovelLibrarySlug) returnParams.set("library", libraryScope.slug);
  if (page > 1) returnParams.set("page", String(page));
  const returnHref = `/tags/search${returnParams.size ? `?${returnParams.toString()}` : ""}`;
  const catalogPaginationParams = new URLSearchParams(returnParams);
  catalogPaginationParams.delete("page");
  const totalCatalogPages = Math.max(1, Math.ceil(totalCatalogItems / pageSize));

  let searchEventKey = contentValidation?.ok && settings.analyticsEnabled
    ? await resolvePostgresSearchEventKey(database("web"), params.searchEvent, contentInput)
    : null;
  if (contentValidation?.ok && settings.analyticsEnabled && !searchEventKey) {
    searchEventKey = await recordPostgresSearchQuery(database("web"), contentInput, "content", {
      source: "advanced_tags",
      userId: user?.id ?? null,
    });
  }
  const [homeLabel, tagsLabel, advancedLabel, noResultsLabel, invalidContentLabel] = await localizeTexts(
    ["首页", "标签", "高级搜索", "没有符合条件的小说", "正文关键词格式有误"] as const,
    locale,
  );

  return (
    <main className="appShell catalogShell advancedTagSearchPage">
      <SiteHeader currentUser={user} library={libraryScope.slug} />
      <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: tagsLabel, href: "/tags" }, { label: advancedLabel }]} />
      <header className="advancedTagSearchHeader userContentHeader">
        <span><Filter size={19} aria-hidden="true" /><h1>{advancedLabel}</h1></span>
      </header>

      <TagIntersectionSearchForm
        groups={groups}
        initialSelected={selectedSlugs}
        initialExcluded={excludedSlugs}
        initialTitleQuery={titleInput}
        initialContentQuery={contentInput}
        sources={localizedNovelSources}
        initialSourceLibrary={libraryScope.slug}
        initialScope="novels"
        originalSearchEnabled={originalSearchEnabled}
        locale={locale}
      />

      <AdvancedSearchResultAnchor count={result?.items.length} scrollKey={`${returnHref}:${page}`} />

      {titleValidation && !titleValidation.ok ? (
        <section className="emptyState"><h2>{titleValidation.message}</h2></section>
      ) : contentInput && !contentValidation?.ok ? (
        <section className="emptyState"><h2>{contentValidation?.message || invalidContentLabel}</h2></section>
      ) : contentValidation?.ok ? (
        <ContentSearchClient
          key={`${libraryScope.slug}:${selectedSlugs.join(",")}:${excludedSlugs.join(",")}:${titleInput}:${contentInput}`}
          keyword={contentInput}
          initialPage={page}
          highlightTerms={contentValidation.query.highlightTerms}
          searchEventKey={searchEventKey}
          searchSource="advanced_tags"
          originNovelId={null}
          library={libraryScope.slug}
          requestFilters={{ includeTags: selectedSlugs, excludeTags: excludedSlugs, titleQuery: titleInput }}
          resultReturnPath="/tags/search"
          resultReturnParams={Object.fromEntries(returnParams)}
          scrollTargetId="advanced-search-results"
        />
      ) : result ? (
        result.items.length ? (
          <CatalogBookGrid books={result.items} returnHref={returnHref} ariaLabel="高级搜索结果" locale={locale} />
        ) : (
          <section className="emptyState"><h2>{noResultsLabel}</h2></section>
        )
      ) : null}

      {result ? (
        <Pagination
          page={Math.min(page, totalCatalogPages)}
          totalPages={totalCatalogPages}
          query=""
          basePath="/tags/search"
          extraParams={Object.fromEntries(catalogPaginationParams)}
          scrollTargetId="advanced-search-results"
        />
      ) : null}
    </main>
  );
}
