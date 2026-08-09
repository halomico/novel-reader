import { Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SiteHeader } from "@/components/SiteHeader";
import { TagVisibilityControl } from "@/components/TagVisibilityControl";
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
import { setTagPreferenceAction } from "../actions";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";

type TagPageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<{
    page?: string;
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
  const pageValue = Number((await searchParams).page || 1);
  const page = Number.isInteger(pageValue) && pageValue > 1 ? pageValue : 1;
  const canonicalPath = canonicalPagePath(`/tags/${tag.slug}`, page);
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
    robots: isPublic ? { index: true, follow: true } : NO_INDEX_ROBOTS,
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
  const result = listNovelsByTag(tag.id, {
    page: Number(query.page || "1"),
    pageSize: getCatalogPageSize(),
    audience,
  });
  const tagsByNovel = filterTagsByNovelForUser(
    listTagsForNovels(result.books.map((book) => book.id), { audience }),
    user?.id,
  );
  const returnParams = new URLSearchParams({ page: String(result.page) });
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
      <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: tagsLabel, href: "/tags" }, { label: displayTag.name }]} />
      <section className="tagDetailHeader">
        <span className="tagLibraryIcon" aria-hidden="true">
          <Tags size={23} />
        </span>
        <div>
          <h1>{displayTag.name}</h1>
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
        </div>
        {user ? (
          <form className="tagPreferenceAction" action={setTagPreferenceAction}>
            <input name="tagId" type="hidden" value={tag.id} />
            <input name="hidden" type="hidden" value={isExplicitlyHidden ? "0" : "1"} />
            <input name="returnPath" type="hidden" value={`/tags/${tag.slug}`} />
            {isHiddenByGroup ? (
              <Link className="tagInheritedVisibility" href="/tags?hidden=1" title={uiText(locale, "前往已隐藏标签")}>
                {uiText(locale, "随分组隐藏")}
              </Link>
            ) : (
              <TagVisibilityControl
                visible={!isExplicitlyHidden}
                label={uiText(locale, isExplicitlyHidden ? "显示此标签" : "隐藏此标签")}
              />
            )}
          </form>
        ) : null}
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
      />
    </main>
  );
}
