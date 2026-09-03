import { FileText, LockKeyhole, MessageCircle, PenLine, ShieldBan } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { OriginalArticleRows } from "@/components/OriginalArticleRows";
import { OriginalCommentManageItem } from "@/components/OriginalCommentManageItem";
import { OriginalAuthorBlockButton } from "@/components/OriginalAuthorBlockButton";
import { Pagination } from "@/components/Pagination";
import { UserWorkspace } from "@/components/UserWorkspace";
import { WorkspacePage, WorkspacePageHeader, WorkspacePrimaryTabs } from "@/components/WorkspacePageChrome";
import { getNoticeDisplaySeconds, getOriginalPublishingSettings, isOriginalChannelEnabled } from "@/lib/config";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { formatRelativeUpdateTime, parseAppDateTime } from "@/lib/date-time";
import { getCurrentUser } from "@/lib/user-auth";
import { listBlockedOriginalAuthors, listOriginalArticles, listOriginalCommentsByAuthor, listOriginalPurchasedArticles } from "@/lib/original";
import { UserAvatar } from "@/components/UserAvatar";
import { uiText } from "@/lib/locale";
import { deleteOwnOriginalCommentAction, updateOwnOriginalCommentAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "文章", robots: { index: false, follow: false } };

type OriginalMinePageProps = {
  searchParams: Promise<{ view?: string; page?: string; notice?: string; tone?: "success" | "warning" | "error" }>;
};

export default async function OriginalMinePage({ searchParams }: OriginalMinePageProps) {
  const user = await getCurrentUser();
  if (!user) notFound();
  if (!isOriginalChannelEnabled()) notFound();
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const params = await searchParams;
  const view = params.view === "comments"
    ? "comments"
    : params.view === "unlocked"
      ? "unlocked"
      : params.view === "blocked"
        ? "blocked"
        : "articles";
  const page = Math.max(Number(params.page || 1), 1);
  const pageSize = getOriginalPublishingSettings().pageSize;
  const articles = view === "articles"
    ? listOriginalArticles({ authorId: user.id, includeUnpublished: true, page, pageSize, sort: "latest" })
    : { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  const comments = view === "comments"
    ? listOriginalCommentsByAuthor(user.id, { includeHidden: true, page, pageSize })
    : { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  const unlocked = view === "unlocked"
    ? listOriginalPurchasedArticles(user.id, { page, pageSize })
    : { items: [], page: 1, pageSize, totalItems: 0, totalPages: 1 };
  const blockedAuthors = view === "blocked" ? listBlockedOriginalAuthors(user.id) : [];
  const displayArticles = await Promise.all(articles.items.map(async (article) => ({
    ...article,
    title: await localizeText(article.title, locale),
    authorName: await localizeText(article.authorName, locale),
    tags: await Promise.all(article.tags.map(async (tag) => ({ ...tag, name: await localizeText(tag.name, locale) }))),
  })));
  const displayUnlocked = await Promise.all(unlocked.items.map(async (article) => ({
    ...article,
    title: await localizeText(article.title, locale),
    authorName: await localizeText(article.authorName, locale),
    tags: await Promise.all(article.tags.map(async (tag) => ({ ...tag, name: await localizeText(tag.name, locale) }))),
  })));
  const displayComments = await Promise.all(comments.items.map(async (comment) => ({
    ...comment,
    authorName: await localizeText(comment.authorName, locale),
    articleTitle: await localizeText(comment.articleTitle, locale),
    bodyMarkdown: await localizeText(comment.bodyMarkdown, locale),
  })));

  return (
    <UserWorkspace user={user} active="articles" breadcrumb={tr("文章")}>
      {params.notice ? <DismissibleNotice message={params.notice} tone={params.tone} variant="search" displaySeconds={getNoticeDisplaySeconds()} /> : null}
      <WorkspacePage className="originalMinePage">
        <WorkspacePageHeader
          className="originalMineHeader"
          icon={FileText}
          title={tr("文章")}
          trailing={<Link className="originalPrimaryButton" href="/original/new"><PenLine size={15} aria-hidden="true" />{tr("发布文章")}</Link>}
        />
        <WorkspacePrimaryTabs
          className="originalMineTabs"
          label={tr("文章管理")}
          items={[
            { href: "/original/mine", label: tr("原创"), icon: FileText, active: view === "articles" },
            { href: "/original/mine?view=comments", label: tr("回复"), icon: MessageCircle, active: view === "comments" },
            { href: "/original/mine?view=unlocked", label: tr("解锁"), icon: LockKeyhole, active: view === "unlocked" },
            { href: "/original/mine?view=blocked", label: tr("屏蔽"), icon: ShieldBan, active: view === "blocked" },
          ]}
        />
        {view === "articles" ? (
          <>
            <OriginalArticleRows items={displayArticles} locale={locale} showStatus showEdit />
            {!displayArticles.length ? <p className="originalEmpty">{tr("暂无文章")}</p> : null}
            <Pagination page={articles.page} totalPages={articles.totalPages} query="" basePath="/original/mine" />
          </>
        ) : view === "comments" ? (
          <>
            <div className="originalMineCommentList">
              {displayComments.map((comment) => (
                <OriginalCommentManageItem
                  key={comment.id}
                  comment={comment}
                  displayDate={formatRelativeUpdateTime(parseAppDateTime(comment.createdAt)?.getTime() || Date.now(), {
                    justNow: tr("刚刚"),
                    minutesAgo: tr("分钟前"),
                    hoursAgo: tr("小时前"),
                    daysAgo: tr("天前"),
                  })}
                  editAction={updateOwnOriginalCommentAction}
                  deleteAction={deleteOwnOriginalCommentAction}
                  labels={{ edit: tr("编辑"), save: tr("保存"), cancel: tr("取消"), remove: tr("删除"), confirmRemove: tr("确定删除这条回复吗？"), hidden: tr("已隐藏") }}
                />
              ))}
              {!displayComments.length ? <p className="originalEmpty">{tr("暂无回复")}</p> : null}
            </div>
            <Pagination page={comments.page} totalPages={comments.totalPages} query="" basePath="/original/mine" extraParams={{ view: "comments" }} />
          </>
        ) : view === "unlocked" ? (
          <>
            <OriginalArticleRows items={displayUnlocked} locale={locale} />
            {!displayUnlocked.length ? <p className="originalEmpty">{tr("暂无文章")}</p> : null}
            <Pagination page={unlocked.page} totalPages={unlocked.totalPages} query="" basePath="/original/mine" extraParams={{ view: "unlocked" }} />
          </>
        ) : (
          <div className="originalBlockedAuthorList">
            {blockedAuthors.map((author) => (
              <article key={author.authorId}>
                <UserAvatar className="originalBlockedAuthorAvatar" userId={author.authorId} displayName={author.displayName} avatarPath={author.avatarPath} />
                <div><strong>{author.displayName}</strong><small>Lv.{author.trustLevel} · {author.articleCount} {tr("篇文章")}</small></div>
                <OriginalAuthorBlockButton authorId={author.authorId} initialBlocked compact />
              </article>
            ))}
            {!blockedAuthors.length ? <p className="originalEmpty">{tr("暂无屏蔽作者")}</p> : null}
          </div>
        )}
      </WorkspacePage>
    </UserWorkspace>
  );
}
