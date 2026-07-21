import { BookOpenText } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminReaderActions } from "@/components/AdminReaderActions";
import { ReaderTagLinks } from "@/components/ReaderTagLinks";
import { ReportNovelButton } from "@/components/ReportNovelButton";
import { SiteHeader } from "@/components/SiteHeader";
import { getClientIp } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getNovelById, readNovelSegments, type Novel } from "@/lib/books";
import {
  areGuestHotwordLinksEnabled,
  areHotwordLinksEnabled,
  canAccessNovelLibrary,
  isGuestTagLibraryNavEnabled,
  isNovelLibraryPublic,
  isTagLibraryEnabled,
} from "@/lib/config";
import { checkContentAccess } from "@/lib/content-access";
import { listHotwordsForNovel, listTagsForNovel } from "@/lib/tags";
import { isNovelPinned } from "@/lib/pinned-novels";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
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

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const bookId = Number((await params).id);
  const book = Number.isInteger(bookId) && bookId > 0 ? getNovelById(bookId) : null;
  if (!book) {
    return { title: "小说不存在", robots: NO_INDEX_ROBOTS };
  }
  const canonical = `/books/${book.id}`;
  const description = `在线阅读《${book.title}》。`;
  return {
    title: book.title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "article",
      title: book.title,
      description,
      url: canonical,
    },
    robots: isNovelLibraryPublic() ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

type CurrentUser = Awaited<ReturnType<typeof getCurrentUser>>;

function safeReturnHref(value: string | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/novels";
}

function ReaderContentLoading() {
  return (
    <div className="readerContentLoading" role="status" aria-label="正文加载中">
      {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
    </div>
  );
}

function ReaderHotwordLinks({ hotwords, novelId }: { hotwords: string[]; novelId: number }) {
  if (!hotwords.length) {
    return null;
  }
  return (
    <nav className="readerHotwordLinks" aria-label="文末热词">
      {hotwords.map((term) => (
        <Link href={`/search?q=${encodeURIComponent(term)}&source=reader_hotword&origin=${novelId}`} key={term}>
          {term}
        </Link>
      ))}
    </nav>
  );
}

async function ReaderContent({
  book,
  hitSegment,
  requestHeaders,
  user,
}: {
  book: Novel;
  hitSegment: number;
  requestHeaders: Awaited<ReturnType<typeof headers>>;
  user: CurrentUser;
}) {
  const segments = await readNovelSegments(book);
  recordNovelVisit(book.id, getClientIp(requestHeaders), requestHeaders.get("user-agent") || "");
  recordAnalyticsEvent({
    headers: requestHeaders,
    userId: user?.id ?? null,
    eventType: "book_view",
    path: `/books/${book.id}`,
    referrer: requestHeaders.get("referer"),
    novelId: book.id,
  });
  if (user) {
    recordReadingHistory(user.id, book, hitSegment);
  }

  return (
    <div className="readerText">
      {segments.map((segment) => (
        <section
          className="readerSegment"
          data-segment-index={segment.segmentIndex}
          data-search-target={segment.segmentIndex === hitSegment ? "true" : undefined}
          id={`seg-${segment.segmentIndex}`}
          key={segment.segmentIndex}
        >
          {segment.content}
        </section>
      ))}
    </div>
  );
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

  const [user, adminSession] = await Promise.all([getCurrentUser(), getAdminSession()]);
  const authenticated = Boolean(user || adminSession);
  if (!adminSession && !canAccessNovelLibrary(Boolean(user))) {
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
  const showTags = isTagLibraryEnabled() && (authenticated || isGuestTagLibraryNavEnabled());
  const showHotwords = areHotwordLinksEnabled() && (authenticated || areGuestHotwordLinksEnabled());
  const tags = showTags ? listTagsForNovel(book.id) : [];
  const hotwords = showHotwords ? listHotwordsForNovel(book.id) : [];

  return (
    <main className="readerShell">
      <SiteHeader defaultSearchMode="current" showCurrentSearch currentUser={user} />

      <article className="readerPage hasReaderPreferences">
        <Breadcrumbs
          className="readerBreadcrumbs"
          items={[
            { label: "首页", href: "/" },
            { label: "小说", href: safeReturnHref(query.from) },
            { label: book.title },
          ]}
        />
        <header className="readerTitle">
          <BookOpenText size={26} aria-hidden="true" />
          <h1>{book.title}</h1>
          {adminSession ? (
            <AdminReaderActions bookId={book.id} title={book.title} isPinned={isNovelPinned(book.id)} />
          ) : user ? (
            <ReportNovelButton novelId={book.id} title={book.title} />
          ) : null}
        </header>
        <ReaderTagLinks tags={tags.map(({ id: tagId, name, slug }) => ({ id: tagId, name, slug }))} />
        <Suspense fallback={<ReaderContentLoading />}>
          <ReaderContent book={book} hitSegment={hitSegment} requestHeaders={headerStore} user={user} />
        </Suspense>
        <ReaderHotwordLinks hotwords={hotwords} novelId={book.id} />
      </article>
    </main>
  );
}
