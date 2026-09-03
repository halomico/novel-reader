import { ChevronLeft, ChevronRight, LockKeyhole, MessageCircle } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { OriginalAuthorBlockButton } from "@/components/OriginalAuthorBlockButton";
import { OriginalCommentComposer } from "@/components/OriginalCommentComposer";
import { OriginalArticleTracker } from "@/components/OriginalArticleTracker";
import { OriginalMarkdown } from "@/components/OriginalMarkdown";
import { OriginalReaderExperienceControls } from "@/components/OriginalReaderExperienceControls";
import { Pagination } from "@/components/Pagination";
import { SiteHeader } from "@/components/SiteHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { canAccessOriginalChannel, canConsumeOriginalChannel, getNoticeDisplaySeconds, getOriginalPublishingSettings, isOriginalChannelEnabled, isOriginalChannelEntryVisible } from "@/lib/config";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { formatRelativeUpdateTime, parseAppDateTime } from "@/lib/date-time";
import { formatNovelWordCount } from "@/components/CatalogBookGrid";
import { isOriginalFavorite } from "@/lib/favorites";
import { getOriginalGroveState } from "@/lib/grove";
import {
  getOriginalAccess,
  getAdjacentOriginalArticles,
  getOriginalArticleBySlug,
  getOriginalCommentQuota,
  getOriginalReadingProgress,
  listOriginalCommentsPage,
  isOriginalAuthorBlocked,
} from "@/lib/original";
import { joinOriginalBodies } from "@/lib/original-constants";
import { extractOriginalOutline } from "@/lib/original-outline";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { uiText } from "@/lib/locale";
import { addOriginalCommentAction, purchaseOriginalArticleAction } from "../actions";

export const dynamic = "force-dynamic";

type OriginalDetailProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ comments?: string; notice?: string; tone?: "success" | "warning" | "error"; resume?: string }>;
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const locale = await getRequestLocale();
  const article = getOriginalArticleBySlug((await params).slug);
  if (!article) return { title: uiText(locale, "文章不存在") };
  return { title: await localizeText(article.title, locale), description: await localizeText(article.excerpt, locale) };
}

export default async function OriginalDetailPage({ params, searchParams }: OriginalDetailProps) {
  if (!isOriginalChannelEnabled()) notFound();
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const user = await getCurrentUser();
  if (!canAccessOriginalChannel(Boolean(user))) {
    if (!user && isOriginalChannelEntryVisible(false)) {
      return <ContentEntryGatePage locale={locale} label={tr("原创")} returnTo={`/original/${encodeURIComponent(slug)}`} />;
    }
    notFound();
  }
  const article = getOriginalArticleBySlug(slug);
  if (!article) notFound();
  const access = getOriginalAccess(article, user);
  const channelConsumable = canConsumeOriginalChannel(Boolean(user));
  const contentAllowed = channelConsumable && access.allowed;
  const requestedCommentPage = Math.max(Math.floor(Number(query.comments || 1)) || 1, 1);
  const commentPage = channelConsumable
    ? listOriginalCommentsPage(article.id, { page: requestedCommentPage, pageSize: 30, viewerId: user?.id })
    : { items: [], page: 1, pageSize: 30, totalItems: 0, totalPages: 1 };
  const [title, authorName, publicBody, paidBody] = await Promise.all([
    localizeText(article.title, locale),
    localizeText(article.authorName, locale),
    channelConsumable ? localizeText(article.bodyMarkdown, locale) : Promise.resolve(""),
    contentAllowed ? localizeText(article.paidBodyMarkdown, locale) : Promise.resolve(""),
  ]);
  const displayComments = await Promise.all(commentPage.items.map(async (comment) => ({
    ...comment,
    authorName: await localizeText(comment.authorName, locale),
    bodyMarkdown: await localizeText(comment.bodyMarkdown, locale),
  })));
  const displayTags = await Promise.all(article.tags.map(async (tag) => ({
    ...tag,
    name: await localizeText(tag.name, locale),
  })));
  const visibleBody = contentAllowed ? joinOriginalBodies(publicBody, paidBody) : publicBody;
  const outline = extractOriginalOutline(visibleBody);
  const canEdit = Boolean(user && (user.role === "admin" || user.id === article.authorId));
  const canTip = Boolean(user && user.id !== article.authorId);
  const canReport = Boolean(user?.role === "user" && hasUserPermission(user, "content_report"));
  const commentQuota = user && channelConsumable ? getOriginalCommentQuota(user) : null;
  const originalSettings = getOriginalPublishingSettings();
  const readingProgress = user ? getOriginalReadingProgress(user.id, article.id) : null;
  const favorite = user ? isOriginalFavorite(user.id, article.id) : false;
  const grove = user ? getOriginalGroveState(user.id, article.id) : null;
  const blocked = user ? isOriginalAuthorBlocked(user.id, article.authorId) : false;
  const adjacent = getAdjacentOriginalArticles(article.id, user?.id);
  const [displayPrevious, displayNext] = await Promise.all([
    adjacent.previous ? localizeText(adjacent.previous.title, locale).then((adjacentTitle) => ({ ...adjacent.previous!, title: adjacentTitle })) : null,
    adjacent.next ? localizeText(adjacent.next.title, locale).then((adjacentTitle) => ({ ...adjacent.next!, title: adjacentTitle })) : null,
  ]);
  const relativeTimeLabels = {
    justNow: tr("刚刚"),
    minutesAgo: tr("分钟前"),
    hoursAgo: tr("小时前"),
    daysAgo: tr("天前"),
  };
  return (
    <main className="readerShell originalReaderShell" data-reader-theme="app">
      <SiteHeader currentUser={user} readerMode readerAutoHideOnScroll={false} showSearch={false} showPrimaryNavigation={false} mobileBackHref="/original" mobileBackLabel={tr("返回原创")} />
      <article className="readerPage originalDetail">
        <Breadcrumbs className="readerBreadcrumbs" items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: title }]} />
        {query.notice ? <DismissibleNotice message={query.notice} tone={query.tone} variant="search" displaySeconds={getNoticeDisplaySeconds()} /> : null}
        <OriginalArticleTracker
          articleId={article.id}
          slug={article.slug}
          engagementTargetId={channelConsumable ? "original-content" : "original-access-gate"}
          readingProgressEnabled={Boolean(user?.originalReadingHistoryEnabled && contentAllowed)}
          resume={query.resume === "1"}
          initialRatio={readingProgress?.scrollRatio || 0}
        />
        <header className="originalDetailHeader">
          <div className="readerTitle originalDetailTitleLine">
            <h1>{title}</h1>
          </div>
          {displayTags.length ? (
            <nav className="readerTagLinks originalDetailTags" aria-label={tr("文章标签")}>
              {displayTags.map((tag) => <Link className="tagChip contentTagLink" href={`/original/tags/${encodeURIComponent(tag.slug)}`} key={tag.id}>{tag.name}</Link>)}
            </nav>
          ) : null}
          <div className="originalDetailIdentity">
            <UserAvatar className="originalDetailAuthorAvatar" userId={article.authorId} displayName={authorName} avatarPath={article.authorAvatarPath} />
            <div>
              <Link className="originalAuthorLink" href={`/original/author/${article.authorId}`}>{authorName}</Link>
              <p>
                <time dateTime={article.createdAt}>{tr("发布于")} {formatRelativeUpdateTime(parseAppDateTime(article.publishedAt || article.createdAt)?.getTime() || Date.now(), relativeTimeLabels)}</time>
                <span>{formatNovelWordCount(article.wordCount, locale)}</span>
              </p>
            </div>
            {user && user.id !== article.authorId ? <OriginalAuthorBlockButton authorId={article.authorId} initialBlocked={blocked} compact returnTo="/original" /> : null}
          </div>
        </header>

        {channelConsumable ? (
          <div className="originalReadingLayout" id="original-content">
            <div className="originalReaderStage">
              <div className="readerText originalBody" id="original-body">
                <OriginalMarkdown>{visibleBody}</OriginalMarkdown>
              </div>
            </div>
            <OriginalReaderExperienceControls
              articleId={article.id}
              title={title}
              items={outline}
              previous={displayPrevious}
              next={displayNext}
              authenticated={Boolean(user)}
              canTip={canTip}
              canReport={canReport}
              initialFavorite={favorite}
              initialInGrove={Boolean(grove?.planted)}
              editHref={canEdit ? `/original/${article.slug}/edit` : undefined}
            />
          </div>
        ) : null}

        {!contentAllowed ? (
          <section className="originalGate" id="original-access-gate" aria-live="polite">
            <LockKeyhole size={23} aria-hidden="true" />
            <strong>{!channelConsumable
              ? tr("登录后查看完整内容")
              : `${tr("解锁完整内容")} · ${article.unlockSodaPrice} ${tr("苏打")}`}</strong>
            {!user ? (
              <Link className="originalPrimaryButton" href={`/login?returnTo=${encodeURIComponent(`/original/${article.slug}`)}`}>{tr("登录")}</Link>
            ) : channelConsumable && article.accessMode === "paid" && article.unlockSodaPrice > 0 ? (
              <form action={purchaseOriginalArticleAction}>
                <input type="hidden" name="articleId" value={article.id} />
                <input type="hidden" name="slug" value={article.slug} />
                <button className="originalPrimaryButton" type="submit"><LockKeyhole size={16} aria-hidden="true" />{tr("解锁")}</button>
              </form>
            ) : null}
          </section>
        ) : null}

        {(displayPrevious || displayNext) ? (
          <nav className="readerNovelNavigation originalArticleNavigation" aria-label={tr("文章导航")}>
            {displayPrevious ? (
              <Link className="readerNovelLink readerNovelPrevious" href={`/original/${encodeURIComponent(displayPrevious.slug)}`} aria-label={`${tr("上一篇")}：${displayPrevious.title}`} title={`${tr("上一篇")}：${displayPrevious.title}`}>
                <span className="readerNovelArrow"><ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" /></span>
                <span className="readerNovelTitle"><strong>{displayPrevious.title}</strong></span>
              </Link>
            ) : null}
            {displayNext ? (
              <Link className="readerNovelLink readerNovelNext" href={`/original/${encodeURIComponent(displayNext.slug)}`} aria-label={`${tr("下一篇")}：${displayNext.title}`} title={`${tr("下一篇")}：${displayNext.title}`}>
                <span className="readerNovelTitle"><strong>{displayNext.title}</strong></span>
                <span className="readerNovelArrow"><ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" /></span>
              </Link>
            ) : null}
          </nav>
        ) : null}

        <section className="originalComments" id="original-comments">
            <header><MessageCircle size={17} aria-hidden="true" /><h2>{tr("评论")}</h2></header>
            <div className="originalCommentList">
              {displayComments.map((comment) => (
                <article key={comment.id}>
                  <header>
                    <UserAvatar className="originalCommentAvatar" userId={comment.authorId} displayName={comment.authorName} avatarPath={comment.authorAvatarPath} />
                    <div>
                      <Link className="originalCommentAuthor" href={`/original/author/${comment.authorId}`}>{comment.authorName}</Link>
                      <time dateTime={comment.createdAt}>{formatRelativeUpdateTime(parseAppDateTime(comment.createdAt)?.getTime() || Date.now(), relativeTimeLabels)}</time>
                    </div>
                  </header>
                  <div><OriginalMarkdown>{comment.bodyMarkdown}</OriginalMarkdown></div>
                </article>
              ))}
              {!displayComments.length ? <p className="originalEmpty">{tr("暂无评论")}</p> : null}
            </div>
            <Pagination
              page={commentPage.page}
              totalPages={commentPage.totalPages}
              query=""
              basePath={`/original/${encodeURIComponent(article.slug)}`}
              pageParam="comments"
              scrollTargetId="original-comments"
            />
            {user && channelConsumable && commentQuota ? (
              <OriginalCommentComposer
                action={addOriginalCommentAction}
                articleId={article.id}
                slug={article.slug}
                quota={commentQuota}
                locale={locale}
                minChars={originalSettings.commentMinChars}
                noticeDisplaySeconds={getNoticeDisplaySeconds()}
              />
            ) : <p className="originalLoginHint"><Link href={`/login?returnTo=${encodeURIComponent(`/original/${article.slug}`)}`}>{tr("登录")}</Link>{tr("后参与评论")}</p>}
        </section>
      </article>
    </main>
  );
}
