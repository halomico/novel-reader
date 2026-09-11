import { CupSoda, FileText, UserRound } from "lucide-react";
import { AppLink } from "@/components/AppLink";
import { Pagination } from "@/components/Pagination";
import type { PostgresOriginalSearchItem } from "@/domains/originals/postgres-search";
import { formatNovelWordCount } from "@/components/CatalogBookGrid";
import { formatCompactUpdateDate, parseAppDateTime } from "@/lib/date-time";
import { uiText, type AppLocale } from "@/lib/locale";

export function OriginalAdvancedSearchResults({
  items,
  locale,
  page,
  totalPages,
  paginationParams,
}: {
  items: PostgresOriginalSearchItem[];
  locale: AppLocale;
  page: number;
  totalPages: number;
  paginationParams: Record<string, string | undefined>;
}) {
  const tr = (text: string) => uiText(locale, text);
  return (
    <section className="originalAdvancedResults" aria-label={tr("原创文章搜索结果")}>
      <div className="originalAdvancedResultList">
        {items.map((article) => (
          <article className="originalAdvancedResult" key={article.id}>
            <div className="originalAdvancedResultTitle">
              <FileText size={15} aria-hidden="true" />
              <AppLink href={`/original/${article.slug}`}>{article.title}</AppLink>
              {article.unlockSodaPrice > 0 ? (
                <span className="originalAdvancedPrice" title={tr("已解锁的付费文章")}>
                  <CupSoda size={12} aria-hidden="true" />{article.unlockSodaPrice}
                </span>
              ) : null}
            </div>
            {article.snippet ? <p>{article.snippet}</p> : null}
            <div className="originalAdvancedResultMeta">
              <span><UserRound size={12} aria-hidden="true" />{article.authorName}</span>
              <time dateTime={article.publishedAt}>{formatCompactUpdateDate(parseAppDateTime(article.publishedAt)?.getTime() || Date.now())}</time>
              <span>{formatNovelWordCount(article.wordCount, locale)}</span>
              {article.tags.slice(0, 3).map((tag) => <span className="tagChip originalAdvancedTag" key={tag.id}>{tag.name}</span>)}
            </div>
          </article>
        ))}
      </div>
      <Pagination
        page={Math.min(page, totalPages)}
        totalPages={totalPages}
        query=""
        basePath="/tags/search"
        extraParams={paginationParams}
        scrollTargetId="advanced-search-results"
      />
    </section>
  );
}
