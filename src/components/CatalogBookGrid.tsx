import { BookText } from "lucide-react";
import type { Novel } from "@/lib/books";
import type { Tag } from "@/lib/tags";
import { SearchTrackedLink } from "@/components/SearchTrackedLink";

export function CatalogBookCard({
  book,
  returnHref,
  tags = [],
  searchEventKey,
}: {
  book: Novel;
  returnHref: string;
  tags?: Tag[];
  searchEventKey?: string | null;
}) {
  return (
    <SearchTrackedLink
      className="bookCard"
      eventKey={searchEventKey}
      href={`/books/${book.id}?from=${encodeURIComponent(returnHref)}`}
      novelId={book.id}
    >
      <span className="bookMark" aria-hidden="true">
        <BookText size={20} />
      </span>
      <span className="bookCardBody">
        <span className="bookTitle">{book.title}</span>
        {tags.length ? (
          <span className="bookCardTags" aria-label={`标签：${tags.map((tag) => tag.name).join("、")}`}>
            {tags.map((tag) => `#${tag.name}`).join("  ")}
          </span>
        ) : null}
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
}: {
  books: Novel[];
  returnHref: string;
  ariaLabel: string;
  tagsByNovel?: ReadonlyMap<number, Tag[]>;
  searchEventKey?: string | null;
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
            key={book.id}
          />
        );
      })}
    </section>
  );
}
