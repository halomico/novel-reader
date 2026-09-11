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
import { defaultOriginalSortOrder, getOriginalTagBySlug, listOriginalArticles, normalizeOriginalSort, normalizeOriginalSortOrder } from "@/domains/originals/postgres-originals";

export const dynamic = "force-dynamic";

type OriginalTagPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ sort?: string; order?: string; page?: string }>;
};

export async function generateMetadata({ params }: OriginalTagPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const tag = await getOriginalTagBySlug((await params).slug, { publishedOnly: true });
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
  const tag = await getOriginalTagBySlug(slug, { publishedOnly: true });
  if (!tag) notFound();
  const sort = normalizeOriginalSort(query.sort);
  const order = normalizeOriginalSortOrder(query.order, sort);
  const result = await listOriginalArticles({ tagSlug: tag.slug, sort, sortOrder: order, page: Number(query.page || 1), viewerId: user?.id });
  const displayTagName = await localizeText(tag.name, locale);
  const items = await Promise.all(result.items.map(async (article) => ({
    ...article,
    title: await localizeText(article.title, locale),
    authorName: await localizeText(article.authorName, locale),
    tags: await Promise.all(article.tags.map(async (item) => ({ ...item, name: await localizeText(item.name, locale) }))),
  })));

  return (
    <main className="appShell originalShell originalTagDetailShell">
      <SiteHeader currentUser={user} searchScope="originals" />
      <PageContextBar
        items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: tr("标签"), href: "/original/tags" }, { label: displayTagName }]}
        search={<OriginalBrowseControls q="" tag={tag.slug} sort={sort} order={order} locale={locale} />}
      />
      <section className="originalPage">
        <header className="tagDetailHeader originalTagDetailHeader">
          <div className="tagDetailHeadingRow">
            <h1>{displayTagName}</h1>
          </div>
          <div className="tagDetailMeta">
            <span className="resultCount originalTagDetailCount">{result.totalItems.toLocaleString("zh-CN")} {tr("篇文章")}</span>
          </div>
        </header>
        <OriginalArticleRows items={items} locale={locale} query={{ q: "", sort, order }} />
        {!items.length ? <p className="originalEmpty">{tr("暂无文章")}</p> : null}
        <Pagination page={result.page} totalPages={result.totalPages} query="" basePath={`/original/tags/${tag.slug}`} extraParams={{ sort: sort === "latest" ? undefined : sort, order: order === defaultOriginalSortOrder(sort) ? undefined : order }} />
      </section>
    </main>
  );
}
