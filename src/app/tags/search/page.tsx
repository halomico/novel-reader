import { ListFilter } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdvancedSearchResultAnchor } from "@/components/AdvancedSearchResultAnchor";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentSearchClient } from "@/components/ContentSearchClient";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { TagIntersectionSearchForm, type AdvancedTagGroup } from "@/components/TagIntersectionSearchForm";
import { getAdminSession } from "@/lib/admin-auth";
import { recordSearchQuery, resolveSearchQueryEventKey } from "@/lib/analytics";
import {
  canAccessAdvancedTagSearch,
  getCatalogPageSize,
  getSearchResultsPageSize,
  shouldShowProgressBars,
} from "@/lib/config";
import { validateSearchKeyword } from "@/lib/search";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { listNovelsByTagIntersection, listTagGroups, listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "高级搜索", robots: NO_INDEX_ROBOTS };

type AdvancedTagSearchPageProps = {
  searchParams: Promise<{
    tags?: string;
    exclude?: string;
    q?: string;
    content?: string;
    page?: string;
    searchEvent?: string;
  }>;
};

export default async function AdvancedTagSearchPage({ searchParams }: AdvancedTagSearchPageProps) {
  const params = await searchParams;
  const [user, adminSession] = await Promise.all([getCurrentUser(), getAdminSession()]);
  if (!adminSession && !canAccessAdvancedTagSearch(Boolean(user))) notFound();

  const sourceGroups = listTagGroups();
  const groups: AdvancedTagGroup[] = sourceGroups.flatMap((group) => {
    const tags = group.tags.length ? group.tags : group.group ? [group.group] : [];
    return tags.length
      ? [{
          label: group.group?.name || "未分组",
          tags: tags.map((tag) => ({ id: tag.id, name: tag.name, slug: tag.slug, aliases: tag.aliases, count: tag.directCount })),
        }]
      : [];
  });
  const tagBySlug = new Map(groups.flatMap((group) => group.tags).map((tag) => [tag.slug, tag]));
  const selectedSlugs = Array.from(new Set((params.tags || "").split(",").map((slug) => slug.trim()).filter((slug) => tagBySlug.has(slug)))).slice(0, 20);
  const excludedSlugs = Array.from(new Set((params.exclude || "").split(",").map((slug) => slug.trim()).filter((slug) => tagBySlug.has(slug) && !selectedSlugs.includes(slug)))).slice(0, 20);
  const selectedTags = selectedSlugs.map((slug) => tagBySlug.get(slug)!);
  const excludedTags = excludedSlugs.map((slug) => tagBySlug.get(slug)!);
  const titleQuery = (params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const contentInput = (params.content || "").trim();
  const contentValidation = contentInput ? validateSearchKeyword(contentInput) : null;
  const pageValue = Number(params.page || 1);
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.floor(pageValue) : 1;
  const result = (selectedTags.length > 0 || Boolean(titleQuery)) && !contentInput
    ? listNovelsByTagIntersection(selectedTags.map((tag) => tag.id), {
        excludeTagIds: excludedTags.map((tag) => tag.id),
        page,
        pageSize: getCatalogPageSize(),
        q: titleQuery,
      })
    : null;
  const tagsByNovel = result ? listTagsForNovels(result.books.map((book) => book.id)) : new Map();
  const returnParams = new URLSearchParams();
  if (selectedSlugs.length) returnParams.set("tags", selectedSlugs.join(","));
  if (excludedSlugs.length) returnParams.set("exclude", excludedSlugs.join(","));
  if (titleQuery) returnParams.set("q", titleQuery);
  if (contentValidation?.ok) returnParams.set("content", contentValidation.keyword);
  if (page > 1) returnParams.set("page", String(page));
  const returnHref = `/tags/search${returnParams.size ? `?${returnParams.toString()}` : ""}`;

  let searchEventKey = contentValidation?.ok
    ? resolveSearchQueryEventKey(params.searchEvent, contentValidation.keyword)
    : null;
  if (contentValidation?.ok && !searchEventKey) {
    searchEventKey = recordSearchQuery(contentValidation.keyword, "content", {
      source: "advanced_tags",
      userId: user?.id ?? null,
    });
  }

  return (
    <main className="appShell catalogShell advancedTagSearchPage">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "标签", href: "/tags" }, { label: "高级搜索" }]} />
      <header className="tagLibraryHeader advancedTagSearchHeader">
        <span className="tagLibraryIcon" aria-hidden="true"><ListFilter size={23} /></span>
        <div>
          <h1>高级搜索</h1>
        </div>
      </header>

      <TagIntersectionSearchForm
        groups={groups}
        initialSelected={selectedSlugs}
        initialExcluded={excludedSlugs}
        initialTitleQuery={titleQuery}
        initialContentQuery={contentValidation?.ok ? contentValidation.keyword : contentInput}
      />

      <AdvancedSearchResultAnchor count={result?.totalBooks} scrollKey={returnHref} />

      {contentInput && !contentValidation?.ok ? (
        <section className="emptyState"><h2>{contentValidation?.message || "正文关键词格式有误"}</h2></section>
      ) : contentValidation?.ok ? (
        <ContentSearchClient
          keyword={contentValidation.keyword}
          initialPage={page}
          hasExplicitPage={Boolean(params.page)}
          pageSize={getSearchResultsPageSize()}
          highlightTerms={contentValidation.query.highlightTerms}
          showProgressBars={shouldShowProgressBars()}
          searchEventKey={searchEventKey}
          searchSource="advanced_tags"
          originNovelId={null}
          requestFilters={{ includeTags: selectedSlugs, excludeTags: excludedSlugs, titleQuery }}
          resultReturnPath="/tags/search"
          resultReturnParams={Object.fromEntries(returnParams)}
          scrollTargetId="advanced-search-results"
        />
      ) : result ? (
        result.books.length ? (
          <CatalogBookGrid books={result.books} returnHref={returnHref} ariaLabel="高级搜索结果" tagsByNovel={tagsByNovel} />
        ) : (
          <section className="emptyState"><h2>没有符合条件的小说</h2></section>
        )
      ) : null}

      {result ? (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          query={result.query}
          basePath="/tags/search"
          extraParams={{ tags: selectedSlugs.join(",") || undefined, exclude: excludedSlugs.join(",") || undefined }}
          hash="advanced-search-results"
        />
      ) : null}
    </main>
  );
}
