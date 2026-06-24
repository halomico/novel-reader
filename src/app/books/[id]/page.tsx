import { BookOpenText } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { getNovelById, readNovelSegments } from "@/lib/books";
import { checkContentAccess } from "@/lib/content-access";

export const dynamic = "force-dynamic";

type BookPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    hit?: string;
  }>;
};

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const access = checkContentAccess(await headers());
  if (!access.allowed) {
    return (
      <main className="readerShell">
        <SiteHeader />
        <section className="emptyState">
          <h2>{access.message}</h2>
        </section>
      </main>
    );
  }

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
  const hitSegment = Number(query.hit);

  return (
    <main className="readerShell">
      <SiteHeader defaultSearchMode="current" showCurrentSearch />

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
