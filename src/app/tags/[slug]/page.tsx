import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CatalogRandomButton } from "@/components/CatalogRandomButton";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { NovelCatalogSort } from "@/components/NovelCatalogSort";
import { PageContextBar } from "@/components/PageContextBar";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SiteHeader } from "@/components/SiteHeader";
import { TagPreferenceToggle } from "@/components/TagPreferenceToggle";
import {
  canAccessTagLibrary,
  getCatalogPageSize,
  isGuestTagLibraryNavEnabled,
  isTagLibraryEnabled,
  isTagLibraryPublic,
} from "@/lib/config";
import { getTagBySlug, listNovelsByTag, listTagsForNovels } from "@/lib/tags";
import { canonicalPagePath, NO_INDEX_ROBOTS } from "@/lib/seo";
import {
  filterTagsByNovelForUser,
  listEffectivelyHiddenTagIds,
  listExplicitlyHiddenTagIds,
} from "@/lib/tag-preferences";
import { getCurrentUser } from "@/lib/user-auth";
import { checkContentAccess } from "@/lib/content-access";
import {
  defaultNovelCatalogSortOrder,
  normalizeNovelCatalogSort,
  normalizeNovelCatalogSortOrder,
} from "@/lib/books";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";

type TagPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    page?: string;
    sort?: string;
    order?: string;
    random?: string;
  }>;
};

export async function generateMetadata({ params, searchParams }: TagPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessTagLibrary(Boolean(user))) {
    return { title: uiText(locale, "标签"), robots: NO_INDEX_ROBOTS };
  }
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const tag = getTagBySlug((await params).slug, { audience });
  if (!tag) {
    return { title: uiText(locale, "标签不存在"), robots: NO_INDEX_ROBOTS };
  }
  const query = await searchParams;
  const pageValue = Number(query.page || 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;
  const sortBy = normalizeNovelCatalogSort(query.sort);
  const sortOrder = normalizeNovelCatalogSortOrder(query.order, sortBy);
  const isVariant = sortBy !== "updated" || sortOrder !== "desc" || Boolean(query.random?.trim());
  const canonicalPath = isVariant ? `/tags/${tag.slug}` : canonicalPagePath(`/tags/${tag.slug}`, page);
  const canonical = withLocalePath(canonicalPath, locale);
  const isPublic = tag.visibility === "public" && isTagLibraryEnabled() && isTagLibraryPublic();
  const displayName = await localizeText(tag.name, locale);
  const description = tag.description
    ? await localizeText(tag.description, locale)
    : locale === "zh-Hant"
      ? `瀏覽「${displayName}」標籤下的小說。`
      : `浏览“${displayName}”标签下的小说。`;
  return {
    title: page > 1
      ? locale === "zh-Hant" ? `${displayName} 第 ${page} 頁` : `${displayName} 第 ${page} 页`
      : displayName,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isPublic && !isVariant ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title: displayName, description, url: canonical },
  };
}

export default async function TagPage({ params, searchParams }: TagPageProps) {
  const locale = await getRequestLocale();
  if (!isTagLibraryEnabled()) {
    notFound();
  }
  const user = await getCurrentUser();
  if (!canAccessTagLibrary(Boolean(user))) {
    if (!user && isGuestTagLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "标签")} returnTo="/tags" />;
    }
    notFound();
  }
  const access = checkContentAccess(await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const { slug } = await params;
  const query = await searchParams;
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const tag = getTagBySlug(slug, { audience });
  if (!tag) {
    notFound();
  }
  const sortBy = normalizeNovelCatalogSort(query.sort);
  const sortOrder = normalizeNovelCatalogSortOrder(query.order, sortBy);
  const randomSeed = query.random?.trim().slice(0, 64) || "";
  const result = listNovelsByTag(tag.id, {
    page: Number(query.page || "1"),
    pageSize: getCatalogPageSize(),
    audience,
    sortBy,
    sortOrder,
    randomSeed,
  });
  const tagsByNovel = filterTagsByNovelForUser(
    listTagsForNovels(result.books.map((book) => book.id), { audience }),
    user?.id,
  );
  const returnParams = new URLSearchParams({ page: String(result.page) });
  if (sortBy !== "updated") returnParams.set("sort", sortBy);
  if (sortOrder !== defaultNovelCatalogSortOrder(sortBy)) returnParams.set("order", sortOrder);
  if (randomSeed) returnParams.set("random", randomSeed);
  const returnHref = `/tags/${tag.slug}?${returnParams}`;
  const effectiveHidden = user ? listEffectivelyHiddenTagIds(user.id) : new Set<number>();
  const explicitHidden = user ? listExplicitlyHiddenTagIds(user.id) : new Set<number>();
  const isExplicitlyHidden = explicitHidden.has(tag.id);
  const isHiddenByGroup = effectiveHidden.has(tag.id) && !isExplicitlyHidden;
  const displayTag = {
    ...tag,
    name: await localizeText(tag.name, locale),
    description: await localizeText(tag.description, locale),
    aliases: await Promise.all(tag.aliases.map((alias) => localizeText(alias, locale))),
  };
  const displayBooks = await Promise.all(result.books.map(async (book) => ({
    ...book,
    title: await localizeText(book.title, locale),
  })));
  const displayTagsByNovel = new Map(
    await Promise.all(Array.from(tagsByNovel, async ([novelId, tags]) => [
      novelId,
      await Promise.all(tags.map(async (item) => ({
        ...item,
        name: await localizeText(item.name, locale),
      }))),
    ] as const)),
  );
  const [homeLabel, tagsLabel] = await localizeTexts(["首页", "标签"] as const, locale);

  return (
    <main className="appShell catalogShell">
      <SiteHeader currentUser={user} />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: tagsLabel, href: "/tags" }, { label: displayTag.name }]} />
      <section className="tagDetailHeader">
        <div className="tagDetailHeadingRow">
          <h1>{displayTag.name}</h1>
          <div className="tagDetailActions">
            {user ? (
              isHiddenByGroup ? (
                <Link className="tagInheritedVisibility" href="/tags?hidden=1" title={uiText(locale, "前往已隐藏标签")}>
                  {uiText(locale, "随分组隐藏")}
                </Link>
              ) : (
                <TagPreferenceToggle
                  tagId={tag.id}
                  initialVisible={!isExplicitlyHidden}
                  showLabel={uiText(locale, "显示此标签")}
                  hideLabel={uiText(locale, "隐藏此标签")}
                />
              )
            ) : null}
            <NovelCatalogSort sortBy={sortBy} sortOrder={sortOrder} locale={locale} />
            {result.totalBooks > 1 ? <CatalogRandomButton basePath={`/tags/${tag.slug}`} /> : null}
          </div>
        </div>
        {displayTag.description ? <p className="tagDetailDescription">{displayTag.description}</p> : null}
        <div className="tagDetailMeta">
          {displayTag.aliases.length ? (
            <span>
              <small>{uiText(locale, "别名")}</small>
              <strong>{displayTag.aliases.join("、")}</strong>
            </span>
          ) : null}
          <ResultCount count={result.totalBooks} />
        </div>
      </section>

      {result.books.length > 0 ? (
        <CatalogBookGrid
          books={displayBooks}
          returnHref={returnHref}
          ariaLabel={`${displayTag.name} ${tagsLabel}`}
          tagsByNovel={displayTagsByNovel}
        />
      ) : (
        <section className="emptyState">
          <h2>{uiText(locale, "这个标签下暂无小说")}</h2>
        </section>
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        query=""
        basePath={`/tags/${tag.slug}`}
        extraParams={{
          sort: sortBy === "updated" ? undefined : sortBy,
          order: sortOrder === defaultNovelCatalogSortOrder(sortBy) ? undefined : sortOrder,
          random: randomSeed || undefined,
        }}
      />
    </main>
  );
}
