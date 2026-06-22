import { BookOpenText } from "lucide-react";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { BookSearch } from "@/components/BookSearch";
import { SiteHeader } from "@/components/SiteHeader";
import { getNovelById, readNovelSegments } from "@/lib/books";

export const dynamic = "force-dynamic";

type BookPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    from?: string;
    hit?: string;
  }>;
};

function getSafeReturnHref(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  return value;
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const bookId = Number(id);

  if (!Number.isInteger(bookId) || bookId < 1) {
    notFound();
  }

  const book = getNovelById(bookId);
  if (!book) {
    notFound();
  }

  const segments = await readNovelSegments(book);
  const returnHref = getSafeReturnHref(query.from);
  const hitSegment = Number(query.hit);

  return (
    <main className="readerShell">
      <SiteHeader />
      <div className="readerToolbar readerToolbarSticky">
        <BackButton fallbackHref={returnHref} />
        <BookSearch />
      </div>

      <article className="readerPage">
        <header className="readerTitle">
          <BookOpenText size={26} aria-hidden="true" />
          <h1>{book.title}</h1>
        </header>
        <div className="readerText">
          {segments.map((segment) => (
            <section
              className={segment.segmentIndex === hitSegment ? "readerSegment isHit" : "readerSegment"}
              data-segment-index={segment.segmentIndex}
              id={`seg-${segment.segmentIndex}`}
              key={segment.segmentIndex}
            >
              {segment.content}
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
