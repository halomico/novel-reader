import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CatalogRandomButton } from "@/components/CatalogRandomButton";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { NovelCatalogSort } from "@/components/NovelCatalogSort";
import { PageContextBar } from "@/components/PageContextBar";
import { ResultCount } from "@/components/ResultCount";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import {
  defaultPostgresCatalogSortOrder,
  listPostgresTagsForNovels,
  normalizePostgresCatalogSort,
  normalizePostgresCatalogSortOrder,
} from "@/domains/catalog/postgres-catalog";
import {
  countPostgresAdvancedCatalog,
  searchPostgresAdvancedCatalog,
} from "@/domains/catalog/postgres-search";
import { getPostgresCatalogTagBySlug } from "@/domains/catalog/postgres-tags";
import { listPostgresEffectivelyHiddenTagIds } from "@/domains/reading/postgres-reader-catalog";
import { isGuestTagLibraryNavEnabled } from "@/lib/config";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type TagPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    sort?: string;
    order?: string;
    random?: string;
    page?: string;
  }>;
};

export async function generateMetadata({ params, searchParams }: TagPageProps): Promise<Metadata> {
  const [locale, user, settings, route, query] = await Promise.all([
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
    params,
    searchParams,
  ]);
  if (!canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user))) {
    return { title: uiText(locale, "标签"), robots: NO_INDEX_ROBOTS };
  }
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const tag = await getPostgresCatalogTagBySlug(database("web"), route.slug, { audience });
  if (!tag) return { title: uiText(locale, "标签不存在"), robots: NO_INDEX_ROBOTS };
  const sortBy = normalizePostgresCatalogSort(query.sort);
  const sortOrder = normalizePostgresCatalogSortOrder(query.order, sortBy);
  const isVariant = sortBy !== "updated" || sortOrder !== "desc" || Boolean(query.random?.trim()) || Number(query.page || 1) > 1;
  const canonicalPath = `/tags/${tag.slug}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const isPublic = tag.visibility === "public" && canBrowseHomePortal(settings.homePortalAccessModes.tags, false);
  const displayName = await localizeText(tag.name, locale);
  const description = tag.description
    ? await localizeText(tag.description, locale)
    : locale === "zh-Hant" ? `瀏覽「${displayName}」標籤下的小說。` : `浏览“${displayName}”标签下的小说。`;
  return {
    title: displayName,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isPublic && !isVariant ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title: displayName, description, url: canonical },
  };
}

export default async function TagPage({ params, searchParams }: TagPageProps) {
  const [locale, settings, user, route, query] = await Promise.all([
    getRequestLocale(),
    readPostgresSiteSettings(),
    getCurrentUser(),
    params,
    searchParams,
  ]);
  if (settings.homePortalAccessModes.tags === "off") notFound();
  if (!canBrowseHomePortal(settings.homePortalAccessModes.tags, Boolean(user))) {
    if (!user && isGuestTagLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "标签")} returnTo="/tags" />;
    }
    notFound();
  }
  const access = await checkPostgresContentAccess(database("web"), await headers(), {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const audience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const tag = await getPostgresCatalogTagBySlug(database("web"), route.slug, { audience });
  if (!tag) notFound();
  const sortBy = normalizePostgresCatalogSort(query.sort);
  const sortOrder = normalizePostgresCatalogSortOrder(query.order, sortBy);
  const randomSeed = query.random?.normalize("NFKC").trim().slice(0, 64) || "";
  const rawPage = Math.floor(Number(query.page || 1));
  const currentPage = Number.isSafeInteger(rawPage) && rawPage > 0
    ? Math.min(rawPage, Math.floor(2_147_483_647 / settings.catalogPageSize) + 1)
    : 1;
  const searchOptions = {
    includeTagSlugs: [tag.slug],
    audience,
    sortBy,
    sortOrder,
    randomSeed: randomSeed || undefined,
  } as const;
  const [result, totalBooks] = await Promise.all([
    searchPostgresAdvancedCatalog(database("web"), undefined, {
      ...searchOptions,
      offset: (currentPage - 1) * settings.catalogPageSize,
      limit: settings.catalogPageSize,
    }),
    countPostgresAdvancedCatalog(database("web"), undefined, searchOptions),
  ]);
  const [tagsByNovel, hiddenTagIds] = await Promise.all([
    listPostgresTagsForNovels(database("web"), result.items.map((book) => book.id), { audience }),
    listPostgresEffectivelyHiddenTagIds(database("web"), user?.id),
  ]);
  for (const [novelId, tags] of tagsByNovel) {
    tagsByNovel.set(novelId, tags.filter((item) => !hiddenTagIds.has(item.id)));
  }
  const baseParams = new URLSearchParams();
  if (sortBy !== "updated") baseParams.set("sort", sortBy);
  if (sortOrder !== defaultPostgresCatalogSortOrder(sortBy)) baseParams.set("order", sortOrder);
  if (randomSeed) baseParams.set("random", randomSeed);
  if (currentPage > 1) baseParams.set("page", String(currentPage));
  const returnHref = `/tags/${tag.slug}${baseParams.size ? `?${baseParams.toString()}` : ""}`;
  baseParams.delete("page");
  const totalPages = Math.max(1, Math.ceil(totalBooks / settings.catalogPageSize));
  const displayTag = {
    ...tag,
    name: await localizeText(tag.name, locale),
    description: await localizeText(tag.description, locale),
    aliases: await Promise.all(tag.aliases.map((alias) => localizeText(alias, locale))),
  };
  const displayBooks = await Promise.all(result.items.map(async (book) => ({
    ...book,
    title: await localizeText(book.title, locale),
  })));
  const displayTagsByNovel = new Map(
    await Promise.all(Array.from(tagsByNovel, async ([novelId, tags]) => [
      novelId,
      await Promise.all(tags.map(async (item) => ({ ...item, name: await localizeText(item.name, locale) }))),
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
            <NovelCatalogSort sortBy={sortBy} sortOrder={sortOrder} locale={locale} />
            {totalBooks > 1 ? <CatalogRandomButton basePath={`/tags/${tag.slug}`} /> : null}
          </div>
        </div>
        {displayTag.description ? <p className="tagDetailDescription">{displayTag.description}</p> : null}
        <div className="tagDetailMeta">
          {displayTag.aliases.length ? (
            <span><small>{uiText(locale, "别名")}</small><strong>{displayTag.aliases.join("、")}</strong></span>
          ) : null}
          <ResultCount count={totalBooks} />
        </div>
      </section>

      {displayBooks.length ? (
        <CatalogBookGrid
          books={displayBooks}
          returnHref={returnHref}
          ariaLabel={`${displayTag.name} ${tagsLabel}`}
          tagsByNovel={displayTagsByNovel}
          locale={locale}
        />
      ) : (
        <section className="emptyState"><h2>{uiText(locale, "这个标签下暂无小说")}</h2></section>
      )}
      <Pagination
        page={Math.min(currentPage, totalPages)}
        totalPages={totalPages}
        query=""
        basePath={`/tags/${tag.slug}`}
        extraParams={Object.fromEntries(baseParams)}
      />
    </main>
  );
}
