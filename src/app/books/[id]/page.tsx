import { BookOpenText } from "lucide-react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { SiteHeader } from "@/components/SiteHeader";
import { getClientIp } from "@/lib/admin-access";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getNovelById, readNovelSegments } from "@/lib/books";
import { checkContentAccess } from "@/lib/content-access";
import { getCurrentUser } from "@/lib/user-auth";
import { recordNovelVisit, recordReadingHistory } from "@/lib/users";

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

function safeReturnHref(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
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

  const headerStore = await headers();
  const access = checkContentAccess(headerStore);
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

  const hitSegment = Number(query.hit);
  const segments = await readNovelSegments(book);
  recordNovelVisit(book.id, getClientIp(headerStore), headerStore.get("user-agent") || "");
  const user = await getCurrentUser();
  recordAnalyticsEvent({
    headers: headerStore,
    userId: user?.id ?? null,
    eventType: "book_view",
    path: `/books/${book.id}`,
    referrer: headerStore.get("referer"),
    novelId: book.id,
  });
  if (user) {
    recordReadingHistory(user.id, book, hitSegment);
  }

  return (
    <main className="readerShell">
      <SiteHeader defaultSearchMode="current" showCurrentSearch />

      <article className="readerPage">
        <header className="readerTitle">
          <BackButton fallbackHref={safeReturnHref(query.from)} />
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
