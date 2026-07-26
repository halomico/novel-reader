import { BookOpenText } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cache, Suspense } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminReaderActions } from "@/components/AdminReaderActions";
import { ReaderTagLinks } from "@/components/ReaderTagLinks";
import { ReportNovelButton } from "@/components/ReportNovelButton";
import { NovelRecommendationButton } from "@/components/NovelRecommendationButton";
import { NovelFavoriteButton } from "@/components/NovelFavoriteButton";
import { SiteHeader } from "@/components/SiteHeader";
import { getClientIp } from "@/lib/admin-access";
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
import { isNovelFavorite } from "@/lib/favorites";
import { listHotwordsForNovel, listTagsForNovel } from "@/lib/tags";
import { isNovelPinned } from "@/lib/pinned-novels";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { filterTagsForUser } from "@/lib/tag-preferences";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { recordNovelVisit, recordReadingHistory } from "@/lib/users";
import { getNovelRecommendationState } from "@/lib/recommendations";

export const dynamic = "force-dynamic";

const getBookById = cache(getNovelById);

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
  const book = Number.isInteger(bookId) && bookId > 0 ? getBookById(bookId) : null;
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
  after(() => {
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
  });

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

  const book = getBookById(bookId);
  if (!book) {
    notFound();
  }

  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  if (!canAccessNovelLibrary(authenticated)) {
    notFound();
  }

  const headerStore = await headers();
  const access = checkContentAccess(headerStore, {
    scope: "novel",
    authenticated,
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return (
      <main className="readerShell">
        <SiteHeader currentUser={user} />
        <section className="emptyState">
          <h2>{access.message}</h2>
        </section>
      </main>
    );
  }

  const hitSegment = Number(query.hit);
  const showTags = isTagLibraryEnabled() && (authenticated || isGuestTagLibraryNavEnabled());
  const showHotwords = areHotwordLinksEnabled() && (authenticated || areGuestHotwordLinksEnabled());
  const tagAudience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const sourceTags = showTags ? listTagsForNovel(book.id, { audience: tagAudience }) : [];
  const tags = filterTagsForUser(sourceTags, user?.id);
  const hotwords = showHotwords ? listHotwordsForNovel(book.id) : [];
  const recommendation = user ? getNovelRecommendationState(user.id, book.id) : null;
  const favorite = user ? isNovelFavorite(user.id, book.id) : false;
  const canRecommend = hasUserPermission(user, "novel_feedback");
  const canReport = user?.role === "user" && hasUserPermission(user, "content_report");

  return (
    <main className="readerShell">
      <SiteHeader defaultSearchMode="current" showCurrentSearch readerMode currentUser={user} />

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
          {user?.role === "admin" ? (
            <AdminReaderActions bookId={book.id} title={book.title} isPinned={isNovelPinned(book.id)} />
          ) : null}
        </header>
        <ReaderTagLinks tags={tags.map(({ id: tagId, name, slug }) => ({ id: tagId, name, slug }))} />
        <Suspense fallback={<ReaderContentLoading />}>
          <ReaderContent book={book} hitSegment={hitSegment} requestHeaders={headerStore} user={user} />
        </Suspense>
        {user ? (
          <div className="readerFeedbackActions" aria-label="文章操作">
            <NovelFavoriteButton novelId={book.id} initialFavorite={favorite} />
            {canRecommend && recommendation ? (
              <NovelRecommendationButton
                novelId={book.id}
                initialRecommended={recommendation.recommended}
              />
            ) : null}
            {canReport ? <ReportNovelButton novelId={book.id} title={book.title} /> : null}
          </div>
        ) : null}
        <ReaderHotwordLinks hotwords={hotwords} novelId={book.id} />
      </article>
    </main>
  );
}
