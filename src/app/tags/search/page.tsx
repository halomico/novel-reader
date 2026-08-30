import { ListFilter } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdvancedSearchResultAnchor } from "@/components/AdvancedSearchResultAnchor";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { TagIntersectionSearchForm, type AdvancedTagGroup } from "@/components/TagIntersectionSearchForm";
import { recordSearchQuery, resolveSearchQueryEventKey } from "@/lib/analytics";
import {
  canAccessAdvancedTagSearch,
  getCatalogPageSize,
  getDefaultNovelLibrarySlug,
  getSearchResultsPageSize,
  shouldShowProgressBars,
} from "@/lib/config";
import { validateSearchKeyword } from "@/lib/search";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { filterTagsByNovelForUser, listEffectivelyHiddenTagIds } from "@/lib/tag-preferences";
import { listNovelsByTagIntersection, listTagGroups, listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";
import { checkContentAccess } from "@/lib/content-access";
import { hasUserPermission } from "@/lib/user-levels";
import { getRequestLocale, localizeText, localizeTexts, normalizeSearchText } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { DEFAULT_NOVEL_LIBRARY_SLUG, listNovelSources, resolveNovelLibraryScope } from "@/lib/novel-library";

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
  }>;
};

export default async function AdvancedTagSearchPage({ searchParams }: AdvancedTagSearchPageProps) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const canUseAdvancedSearch = canAccessAdvancedTagSearch(false) ||
    (canAccessAdvancedTagSearch(Boolean(user)) && hasUserPermission(user, "advanced_search"));
  if (!canUseAdvancedSearch) notFound();
  const access = checkContentAccess(await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();

  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const novelSources = listNovelSources({ includeEmpty: true })
    .filter((source) => source.slug === DEFAULT_NOVEL_LIBRARY_SLUG || source.novelCount > 0);
  const libraryScope = resolveNovelLibraryScope(
    params.library || params.sourceLibrary || getDefaultNovelLibrarySlug(),
  );
  const activeSource = libraryScope.kind === "source" ? libraryScope.source : null;
  const hiddenTagIds = user ? listEffectivelyHiddenTagIds(user.id) : new Set<number>();
  const sourceGroups = listTagGroups({
    audience,
    sourceId: libraryScope.kind === "source" ? libraryScope.source.id : undefined,
    omitEmpty: true,
  });
  const sourceAdvancedGroups: AdvancedTagGroup[] = sourceGroups.flatMap((group) => {
    const tags = (group.tags.length ? group.tags : group.group ? [group.group] : [])
      .filter((tag) => !hiddenTagIds.has(tag.id));
    return tags.length
      ? [{
          label: group.group?.name || "未分组",
          tags: tags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, aliases: tag.aliases, count: tag.directCount })),
        }]
      : [];
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
  const selectedTags = selectedSlugs.map((slug) => tagBySlug.get(slug)!);
  const excludedTags = excludedSlugs.map((slug) => tagBySlug.get(slug)!);
  const titleInput = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const titleQuery = await normalizeSearchText(titleInput);
  const contentInput = (params.content || "").trim();
  const contentValidation = contentInput ? validateSearchKeyword(contentInput) : null;
  const pageValue = Number(params.page || 1);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;
  const result = (selectedTags.length > 0 || Boolean(titleQuery) || Boolean(activeSource)) && !contentInput
    ? listNovelsByTagIntersection(selectedTags.map((tag) => tag.id), {
        excludeTagIds: excludedTags.map((tag) => tag.id),
        page,
        pageSize: getCatalogPageSize(),
        q: titleQuery,
        audience,
        sourceId: activeSource?.id,
      })
    : null;
  const tagsByNovel = result
    ? filterTagsByNovelForUser(listTagsForNovels(result.books.map((book) => book.id), { audience }), user?.id)
    : new Map();
  const returnParams = new URLSearchParams();
  if (selectedSlugs.length) returnParams.set("tags", selectedSlugs.join(","));
  if (excludedSlugs.length) returnParams.set("exclude", excludedSlugs.join(","));
  if (titleInput) returnParams.set("q", titleInput);
  if (contentInput) returnParams.set("content", contentInput);
  if (libraryScope.slug !== DEFAULT_NOVEL_LIBRARY_SLUG) returnParams.set("library", libraryScope.slug);
  if (page > 1) returnParams.set("page", String(page));
  const returnHref = `/tags/search${returnParams.size ? `?${returnParams.toString()}` : ""}`;

  let searchEventKey = contentValidation?.ok
    ? resolveSearchQueryEventKey(params.searchEvent, contentInput)
    : null;
  if (contentValidation?.ok && !searchEventKey) {
    searchEventKey = recordSearchQuery(contentInput, "content", {
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
        <span><ListFilter size={19} aria-hidden="true" /><h1>{advancedLabel}</h1></span>
      </header>

      <TagIntersectionSearchForm
        groups={groups}
        initialSelected={selectedSlugs}
        initialExcluded={excludedSlugs}
        initialTitleQuery={titleInput}
        initialContentQuery={contentInput}
        sources={novelSources}
        initialSourceLibrary={libraryScope.slug}
        locale={locale}
      />

      <AdvancedSearchResultAnchor count={result?.totalBooks} scrollKey={returnHref} />

      {contentInput && !contentValidation?.ok ? (
        <section className="emptyState"><h2>{contentValidation?.message || invalidContentLabel}</h2></section>
      ) : contentValidation?.ok ? (
        <ContentSearchClient
          keyword={contentInput}
          initialPage={page}
          hasExplicitPage={Boolean(params.page)}
          pageSize={getSearchResultsPageSize()}
          highlightTerms={contentValidation.query.highlightTerms}
          showProgressBars={shouldShowProgressBars()}
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
        result.books.length ? (
          <CatalogBookGrid books={result.books} returnHref={returnHref} ariaLabel="高级搜索结果" tagsByNovel={tagsByNovel} locale={locale} />
        ) : (
          <section className="emptyState"><h2>{noResultsLabel}</h2></section>
        )
      ) : null}

      {result ? (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          query={titleInput}
          basePath="/tags/search"
          extraParams={{ tags: selectedSlugs.join(",") || undefined, exclude: excludedSlugs.join(",") || undefined, library: libraryScope.slug === DEFAULT_NOVEL_LIBRARY_SLUG ? undefined : libraryScope.slug }}
          scrollTargetId="advanced-search-results"
        />
      ) : null}
    </main>
  );
}
