import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { OriginalEditorForm } from "@/components/OriginalEditorForm";
import { SiteHeader } from "@/components/SiteHeader";
import { getNoticeDisplaySeconds, getOriginalPublishingSettings, isOriginalChannelEnabled } from "@/lib/config";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { getOriginalArticleBySlug, listOriginalTags } from "@/lib/original";
import { getCurrentUser } from "@/lib/user-auth";
import { uiText } from "@/lib/locale";
import { updateOriginalArticleAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "编辑文章", robots: { index: false, follow: false } };

export default async function EditOriginalPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }> }) {
  if (!isOriginalChannelEnabled()) redirect("/original");
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const article = getOriginalArticleBySlug(slug, { includeUnpublished: true });
  if (!article || (user.role !== "admin" && article.authorId !== user.id)) notFound();
  const settings = getOriginalPublishingSettings();
  const availableTags = listOriginalTags({ publishedOnly: true });
  return (
    <main className="appShell originalShell originalEditorShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: await localizeText(article.title, locale), href: `/original/${article.slug}` }, { label: tr("编辑文章") }]} />
      {query.notice ? <DismissibleNotice message={query.notice} tone={query.tone} variant="search" displaySeconds={getNoticeDisplaySeconds()} /> : null}
      <section className="originalEditorPage">
        <OriginalEditorForm locale={locale} action={updateOriginalArticleAction} settings={settings} article={article} mode="edit" heading={tr("编辑文章")} closeHref={`/original/${article.slug}`} hiddenFields={{ articleId: article.id, slug: article.slug }} availableTags={availableTags} />
      </section>
    </main>
  );
}
