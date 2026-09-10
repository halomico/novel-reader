import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { OriginalArticleRows } from "@/components/OriginalArticleRows";
import { PageContextBar } from "@/components/PageContextBar";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { canAccessOriginalChannel, isOriginalChannelEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { uiText } from "@/lib/locale";
import { getCurrentUser } from "@/lib/user-auth";
import { database } from "@/core/db/postgres";
import { getPostgresUserById } from "@/domains/identity/postgres-users";
import { isOriginalAuthorBlocked, listOriginalArticles } from "@/domains/originals/postgres-originals";
import { getOriginalPublishingSettings } from "@/lib/config";
import { UserAvatar } from "@/components/UserAvatar";
import { OriginalAuthorBlockButton } from "@/components/OriginalAuthorBlockButton";

export const dynamic = "force-dynamic";

type AuthorPageProps = { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const authorId = Number((await params).id);
  const author = Number.isSafeInteger(authorId) && authorId > 0
    ? await getPostgresUserById(database("web"), authorId)
    : null;
  return { title: author ? `${author.displayName} · 原创` : "作者不存在" };
}

export default async function OriginalAuthorPage({ params, searchParams }: AuthorPageProps) {
  if (!isOriginalChannelEnabled()) notFound();
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const authorId = Number(id);
  if (!Number.isSafeInteger(authorId) || authorId <= 0) notFound();
  const author = await getPostgresUserById(database("web"), authorId);
  if (!author || author.status !== "active") notFound();
  const currentUser = await getCurrentUser();
  if (!canAccessOriginalChannel(Boolean(currentUser))) {
    if (!currentUser && isOriginalChannelEntryVisible(false)) {
      return <ContentEntryGatePage locale={locale} label={tr("原创")} returnTo={`/original/author/${author.id}`} />;
    }
    notFound();
  }
  const [result, blocked] = await Promise.all([
    listOriginalArticles({
      authorId,
      viewerId: currentUser?.id,
      page: Number(query.page || 1),
      pageSize: getOriginalPublishingSettings().pageSize,
    }),
    currentUser ? isOriginalAuthorBlocked(currentUser.id, author.id) : Promise.resolve(false),
  ]);
  const displayName = await localizeText(author.displayName, locale);
  const items = await Promise.all(result.items.map(async (article) => ({
    ...article,
    title: await localizeText(article.title, locale),
    authorName: displayName,
    tags: await Promise.all(article.tags.map(async (tag) => ({ ...tag, name: await localizeText(tag.name, locale) }))),
  })));

  return (
    <main className="appShell originalShell originalAuthorShell">
      <SiteHeader currentUser={currentUser} />
      <PageContextBar items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: displayName }]} />
      <section className="originalPage">
        <header className="originalAuthorProfile">
          <UserAvatar className="originalAuthorAvatar" userId={author.id} displayName={displayName} avatarPath={author.avatarPath} />
          <div className="originalAuthorIdentity">
            <h1>{displayName}</h1>
            <p>@{author.username} · Lv.{author.trustLevel}</p>
          </div>
          <span className="originalAuthorCount">{result.totalItems} {tr("篇文章")}</span>
          {currentUser && currentUser.id !== author.id ? (
            <OriginalAuthorBlockButton authorId={author.id} initialBlocked={blocked} compact />
          ) : null}
        </header>
        <OriginalArticleRows items={items} locale={locale} showAuthor={false} showAvatar={false} />
        {!items.length ? <p className="originalEmpty">{tr("暂无文章")}</p> : null}
        <Pagination page={result.page} totalPages={result.totalPages} query="" basePath={`/original/author/${author.id}`} />
      </section>
    </main>
  );
}
