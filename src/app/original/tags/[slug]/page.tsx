import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { OriginalArticleRows } from "@/components/OriginalArticleRows";
import { OriginalBrowseControls } from "@/components/OriginalBrowseControls";
import { PageContextBar } from "@/components/PageContextBar";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { canAccessOriginalChannel, isOriginalChannelEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { uiText } from "@/lib/locale";
import { getCurrentUser } from "@/lib/user-auth";
import { getOriginalTagBySlug, listOriginalArticles, type OriginalSort } from "@/lib/original";

export const dynamic = "force-dynamic";

type OriginalTagPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; page?: string }>;
};

function normalizeSort(value: string | undefined): OriginalSort {
  return value === "popular" || value === "name" ? value : "latest";
}

export async function generateMetadata({ params }: OriginalTagPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const tag = getOriginalTagBySlug((await params).slug, { publishedOnly: true });
  return { title: tag ? `${await localizeText(tag.name, locale)} · ${uiText(locale, "原创")}` : uiText(locale, "标签") };
}

export default async function OriginalTagPage({ params, searchParams }: OriginalTagPageProps) {
  if (!isOriginalChannelEnabled()) notFound();
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!canAccessOriginalChannel(Boolean(user))) {
    if (!user && isOriginalChannelEntryVisible(false)) {
      return <ContentEntryGatePage locale={locale} label={tr("原创")} returnTo="/original/tags" />;
    }
    notFound();
  }
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const tag = getOriginalTagBySlug(slug, { publishedOnly: true });
  if (!tag) notFound();
  const sort = normalizeSort(query.sort);
  const result = listOriginalArticles({ tagSlug: tag.slug, sort, page: Number(query.page || 1), viewerId: user?.id });
  const displayTagName = await localizeText(tag.name, locale);
  const items = await Promise.all(result.items.map(async (article) => ({
    ...article,
    title: await localizeText(article.title, locale),
    authorName: await localizeText(article.authorName, locale),
    tags: await Promise.all(article.tags.map(async (item) => ({ ...item, name: await localizeText(item.name, locale) }))),
  })));

  return (
    <main className="appShell originalShell originalTagDetailShell">
      <SiteHeader currentUser={user} />
      <PageContextBar items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: tr("标签"), href: "/original/tags" }, { label: displayTagName }]} />
      <section className="originalPage">
        <header className="originalTagDetailHeader">
          <div>
            <span className="originalSectionKicker">{tr("标签")}</span>
            <h1>{displayTagName}</h1>
          </div>
          <span className="originalTagDetailCount">{result.totalItems} {tr("篇文章")}</span>
        </header>
        <OriginalBrowseControls q="" tag={tag.slug} sort={sort} locale={locale} signedIn={Boolean(user)} />
        <OriginalArticleRows items={items} locale={locale} query={{ q: "", sort }} />
        {!items.length ? <p className="originalEmpty">{tr("暂无文章")}</p> : null}
        <Pagination page={result.page} totalPages={result.totalPages} query="" basePath={`/original/tags/${tag.slug}`} extraParams={{ sort: sort === "latest" ? undefined : sort }} />
      </section>
    </main>
  );
}
