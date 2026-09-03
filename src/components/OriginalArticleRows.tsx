import { CupSoda, MessageCircle, Pin, UserRound } from "lucide-react";
import { Fragment } from "react";
import Link from "@/components/LocalizedLink";
import { AppLink } from "@/components/AppLink";
import { formatNovelWordCount } from "@/components/CatalogBookGrid";
import type { AppLocale } from "@/lib/locale";
import { uiText } from "@/lib/locale";
import { formatCompactUpdateDate, parseAppDateTime } from "@/lib/date-time";
import type { OriginalArticle, OriginalSort } from "@/lib/original";
import { UserAvatar } from "./UserAvatar";
import { FavoriteSelectableItem } from "./FavoriteSelectionManager";

type DisplayArticle = OriginalArticle & { title: string; authorName: string };

function tagHref(tag: string, query?: { q: string; sort: OriginalSort }): string {
  const params = new URLSearchParams();
  if (query?.sort && query.sort !== "latest") params.set("sort", query.sort);
  return `/original/tags/${encodeURIComponent(tag)}${params.size ? `?${params.toString()}` : ""}`;
}

export function OriginalArticleRows({
  items,
  locale,
  showAuthor = true,
  showAvatar = true,
  query,
  showStatus = false,
  showEdit = false,
  showStats = true,
  selectable = false,
  resume = false,
}: {
  items: DisplayArticle[];
  locale: AppLocale;
  showAuthor?: boolean;
  showAvatar?: boolean;
  query?: { q: string; sort: OriginalSort };
  showStatus?: boolean;
  showEdit?: boolean;
  showStats?: boolean;
  selectable?: boolean;
  resume?: boolean;
}) {
  const tr = (text: string) => uiText(locale, text);
  return (
    <div className="originalArticleList">
      {items.map((article) => {
        const articleHref = `/original/${article.slug}${resume ? "?resume=1" : ""}`;
        const row = (
        <article className={`originalArticleRow${showAvatar ? "" : " hasNoAvatar"}`}>
          {showAvatar ? <UserAvatar className="originalArticleAvatar" userId={article.authorId} displayName={article.authorName} avatarPath={article.authorAvatarPath} /> : null}
          <div className="originalArticleMain">
            <div className="originalArticleTitleLine">
              <AppLink className="originalArticleTitle" href={articleHref}>{article.title}</AppLink>
              {article.isPinned ? (
                <span className="originalArticlePinned" title={tr("置顶")} aria-label={tr("置顶")}>
                  <Pin size={12} fill="currentColor" aria-hidden="true" />
                </span>
              ) : null}
              {showStatus || showEdit ? (
                <span className="originalRowControls">
                  {showStatus && article.status !== "published" ? <b className={`originalStatus is-${article.status}`}>{tr(article.status === "hidden" ? "已隐藏" : "草稿")}</b> : null}
                  {showEdit ? <Link className="originalRowEdit" prefetch={false} href={`/original/${article.slug}/edit`}>{tr("编辑")}</Link> : null}
                </span>
              ) : null}
            </div>
            <div className="originalArticleSubline">
              {showAuthor ? (
                <>
                  <span className="originalArticleByline">
                    <UserRound className="originalArticleBylineIcon" size={12} aria-hidden="true" />
                    <Link className="originalArticleAuthor" prefetch={false} href={`/original/author/${article.authorId}`}>{article.authorName}</Link>
                  </span>
                  <time dateTime={article.publishedAt || article.createdAt}>{tr("发布于")} {formatCompactUpdateDate(parseAppDateTime(article.publishedAt || article.createdAt)?.getTime() || Date.now())}</time>
                  <span>{formatNovelWordCount(article.wordCount, locale)}</span>
                </>
              ) : (
                <>
                  <span>{formatNovelWordCount(article.wordCount, locale)}</span>
                  <time dateTime={article.publishedAt || article.createdAt}>{tr("发布于")} {formatCompactUpdateDate(parseAppDateTime(article.publishedAt || article.createdAt)?.getTime() || Date.now())}</time>
                </>
              )}
              {showStats ? <span className="originalArticleCommentCount"><MessageCircle size={12} aria-hidden="true" />{article.commentCount}</span> : null}
              {article.unlockSodaPrice > 0 ? (
                <span className="originalArticlePrice"><CupSoda size={13} aria-hidden="true" />{article.unlockSodaPrice}</span>
              ) : null}
              <span className="originalArticleTags" aria-label={tr("文章标签")}>
                {article.tags.slice(0, 3).map((item) => (
                  <Link className="tagChip contentTagLink originalArticleTag" prefetch={false} href={tagHref(item.slug, query)} key={item.id}>{item.name}</Link>
                ))}
                {article.tags.length > 3 ? <span className="originalTagOverflow">+{article.tags.length - 3}</span> : null}
              </span>
            </div>
          </div>
        </article>
        );
        return selectable ? (
          <FavoriteSelectableItem id={article.id} label={article.title} className="originalFavoriteSelectable" key={article.id}>
            {row}
          </FavoriteSelectableItem>
        ) : <Fragment key={article.id}>{row}</Fragment>;
      })}
    </div>
  );
}
