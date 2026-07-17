import { BookText } from "lucide-react";
import Link from "next/link";
import type { Novel } from "@/lib/books";
import type { Tag } from "@/lib/tags";

export function CatalogBookGrid({
  books,
  returnHref,
  ariaLabel,
  tagsByNovel = new Map(),
}: {
  books: Novel[];
  returnHref: string;
  ariaLabel: string;
  tagsByNovel?: ReadonlyMap<number, Tag[]>;
}) {
  return (
    <section className="bookGrid" aria-label={ariaLabel}>
      {books.map((book) => {
        const tags = tagsByNovel.get(book.id) || [];
        return (
          <Link className="bookCard" href={`/books/${book.id}?from=${encodeURIComponent(returnHref)}`} key={book.id}>
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
          </Link>
        );
      })}
    </section>
  );
}
