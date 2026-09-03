import type { Novel } from "@/lib/books";
import type { Tag } from "@/lib/tags";
import { CupSoda } from "lucide-react";
import { formatCompactUpdateDate, parseAppDateTime } from "@/lib/date-time";
import { SearchTrackedLink } from "@/components/SearchTrackedLink";
import { DEFAULT_LOCALE, uiText, type AppLocale } from "@/lib/locale";

export function formatNovelWordCount(wordCount: number, locale: AppLocale = DEFAULT_LOCALE): string {
  const value = Math.max(0, Math.floor(Number(wordCount) || 0));
  const numberLocale = locale === "zh-Hant" ? "zh-Hant" : "zh-CN";
  if (value < 10_000) return `${value}${uiText(locale, "字")}`;
  if (value < 100_000_000) {
    return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value / 10_000)}${uiText(locale, "万字")}`;
  }
  return `${new Intl.NumberFormat(numberLocale, { maximumFractionDigits: 1 }).format(value / 100_000_000)}${uiText(locale, "亿字")}`;
}

export function formatNovelUpdateTime(book: Pick<Novel, "mtime_ms" | "updated_at">, now = Date.now()): string {
  const parsedUpdatedAt = parseAppDateTime(book.updated_at)?.getTime();
  const timestamp = Number.isFinite(book.mtime_ms) && book.mtime_ms > 0
    ? book.mtime_ms
    : typeof parsedUpdatedAt === "number" ? parsedUpdatedAt : now;
  return formatCompactUpdateDate(timestamp, { now });
}

export function CatalogBookCard({
  book,
  returnHref,
  searchEventKey,
  resume = false,
  locale = DEFAULT_LOCALE,
}: {
  book: Novel;
  returnHref: string;
  tags?: Tag[];
  searchEventKey?: string | null;
  resume?: boolean;
  locale?: AppLocale;
}) {
  const showSodaPrice = book.soda_price > 0;
  const showMetadata = book.storage_mode === "chapters" || showSodaPrice;
  const bookPath = book.storage_mode === "chapters"
    ? `/books/${book.id}/chapters`
    : `/books/${book.id}`;
  const query = new URLSearchParams({ from: returnHref });
  if (resume) query.set("resume", "1");
  return (
    <SearchTrackedLink
      className="bookCard"
      eventKey={searchEventKey}
      href={`${bookPath}?${query.toString()}`}
      novelId={book.id}
      returnHref={returnHref}
    >
      <span className="bookCardBody">
        <span className="bookCardMain">
          <span className="bookTitle">{book.title}</span>
          {showMetadata ? (
            <span className="bookCardMeta" aria-label="小说信息">
              {book.storage_mode === "chapters" ? <span>{book.chapter_count}{uiText(locale, "章")}</span> : null}
              {showSodaPrice ? (
                <span className="bookCardSoda" aria-label={`${book.soda_price} 苏打`} title={`${book.soda_price} 苏打`}>
                  <CupSoda size={13} strokeWidth={1.9} aria-hidden="true" />
                  <span>{book.soda_price}</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
        <span className="bookCardSubline">
          <span>{formatNovelWordCount(book.word_count, locale)}</span>
          {"\u00A0\u00A0"}
          <span>{uiText(locale, "发布于")} {formatNovelUpdateTime(book)}</span>
        </span>
      </span>
    </SearchTrackedLink>
  );
}

export function CatalogBookGrid({
  books,
  returnHref,
  ariaLabel,
  tagsByNovel = new Map(),
  searchEventKey,
  resume = false,
  locale = DEFAULT_LOCALE,
}: {
  books: Novel[];
  returnHref: string;
  ariaLabel: string;
  tagsByNovel?: ReadonlyMap<number, Tag[]>;
  searchEventKey?: string | null;
  resume?: boolean;
  locale?: AppLocale;
}) {
  return (
    <section className="bookGrid" aria-label={ariaLabel}>
      {books.map((book) => {
        const tags = tagsByNovel.get(book.id) || [];
        return (
          <CatalogBookCard
            book={book}
            returnHref={returnHref}
            tags={tags}
            searchEventKey={searchEventKey}
            resume={resume}
            locale={locale}
            key={book.id}
          />
        );
      })}
    </section>
  );
}
