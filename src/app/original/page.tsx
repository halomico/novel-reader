import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { OriginalArticleRows } from "@/components/OriginalArticleRows";
import { OriginalBrowseControls } from "@/components/OriginalBrowseControls";
import { PageContextBar } from "@/components/PageContextBar";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { canAccessOriginalChannel, getNoticeDisplaySeconds, isOriginalChannelEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { getRequestLocale, localizeText, normalizeSearchText } from "@/lib/locale-server";
import { defaultOriginalSortOrder, listOriginalArticles, normalizeOriginalSort, normalizeOriginalSortOrder } from "@/domains/originals/postgres-originals";
import { getCurrentUser } from "@/lib/user-auth";
import { uiText } from "@/lib/locale";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: uiText(locale, "原创"), description: uiText(locale, "原创文章目录。") };
}

type OriginalPageProps = {
  searchParams: Promise<{ q?: string; tag?: string; sort?: string; order?: string; page?: string; notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function OriginalPage({ searchParams }: OriginalPageProps) {
  if (!isOriginalChannelEnabled()) notFound();
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!canAccessOriginalChannel(Boolean(user))) {
    if (!user && isOriginalChannelEntryVisible(false)) {
      return <ContentEntryGatePage locale={locale} label={tr("原创")} returnTo="/original" />;
    }
    notFound();
  }
  const params = await searchParams;
  const q = String(params.q || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  const searchQuery = q ? await normalizeSearchText(q) : "";
  const tag = String(params.tag || "").trim().slice(0, 64);
  const sort = normalizeOriginalSort(params.sort);
  const order = normalizeOriginalSortOrder(params.order, sort);
  const page = Number(params.page || 1);
  const result = await listOriginalArticles({ query: searchQuery, tagSlug: tag, sort, sortOrder: order, page, viewerId: user?.id });
  const items = await Promise.all(result.items.map(async (article) => ({
    ...article,
    title: await localizeText(article.title, locale),
    authorName: await localizeText(article.authorName, locale),
    tags: await Promise.all(article.tags.map(async (item) => ({ ...item, name: await localizeText(item.name, locale) }))),
  })));

  return (
    <main className="appShell originalShell">
      <SiteHeader currentUser={user} />
      <PageContextBar
        items={[{ label: tr("首页"), href: "/" }, { label: tr("原创") }]}
        search={<OriginalBrowseControls q={q} tag={tag} sort={sort} order={order} locale={locale} />}
      />
      {params.notice ? <DismissibleNotice message={params.notice} tone={params.tone} variant="search" displaySeconds={getNoticeDisplaySeconds()} /> : null}
      <section className="originalPage">
        <OriginalArticleRows items={items} locale={locale} query={{ q, sort, order }} />
        {!items.length ? <p className="originalEmpty">{tr("暂无文章")}</p> : null}
        <Pagination page={result.page} totalPages={result.totalPages} query={q} basePath="/original" extraParams={{ tag: tag || undefined, sort: sort === "latest" ? undefined : sort, order: order === defaultOriginalSortOrder(sort) ? undefined : order }} />
      </section>
    </main>
  );
}
