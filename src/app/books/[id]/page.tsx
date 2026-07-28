import { BookOpenText } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cache, Suspense } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AdminReaderActions } from "@/components/AdminReaderActions";
import Link from "@/components/LocalizedLink";
import { ReadingProgressTracker } from "@/components/ReadingProgressTracker";
import { ReaderTagLinks } from "@/components/ReaderTagLinks";
import { ReportNovelButton } from "@/components/ReportNovelButton";
import { NovelRecommendationButton } from "@/components/NovelRecommendationButton";
import { NovelFavoriteButton } from "@/components/NovelFavoriteButton";
import { NovelViewTracker } from "@/components/NovelViewTracker";
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
import { languageAlternates, withLocalePath } from "@/lib/locale";
import {
  getRequestLocale,
  localizeNovelSegments,
  localizeText,
  localizeTexts,
} from "@/lib/locale-server";
import {
  getReadingProgress,
  novelContentVersion,
  type ReadingProgress,
} from "@/lib/reading-progress";
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
    resume?: string;
  }>;
};

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const bookId = Number((await params).id);
  const book = Number.isInteger(bookId) && bookId > 0 ? getBookById(bookId) : null;
  if (!book) {
    return { title: await localizeText("小说不存在", locale), robots: NO_INDEX_ROBOTS };
  }
  const title = await localizeText(book.title, locale);
  const canonicalPath = `/books/${book.id}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const description = await localizeText(`在线阅读《${book.title}》。`, locale);
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    openGraph: {
      type: "article",
      title,
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
  locale,
  initialProgress,
  resume,
}: {
  book: Novel;
  hitSegment: number;
  requestHeaders: Awaited<ReturnType<typeof headers>>;
  user: CurrentUser;
  locale: Awaited<ReturnType<typeof getRequestLocale>>;
  initialProgress: ReadingProgress | null;
  resume: boolean;
}) {
  const sourceSegments = await readNovelSegments(book);
  const contentVersion = novelContentVersion(book);
  const segments = await localizeNovelSegments(sourceSegments, locale, contentVersion);
  if (user) {
    after(() => {
      recordNovelVisit(book.id, getClientIp(requestHeaders), requestHeaders.get("user-agent") || "");
      recordAnalyticsEvent({
        headers: requestHeaders,
        userId: user.id,
        eventType: "book_view",
        path: `/books/${book.id}`,
        referrer: requestHeaders.get("referer"),
        novelId: book.id,
      });
      recordReadingHistory(user.id, book, hitSegment);
    });
  }

  return (
    <>
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
      {user ? (
        <ReadingProgressTracker
          novelId={book.id}
          userId={user.id}
          contentVersion={contentVersion}
          totalSegments={segments.length}
          initialProgress={initialProgress}
          resume={resume}
        />
      ) : null}
    </>
  );
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const locale = await getRequestLocale();
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
  const displayTitle = await localizeText(book.title, locale);
  const localizedTagNames = await Promise.all(tags.map((tag) => localizeText(tag.name, locale)));
  const localizedHotwords = await Promise.all(hotwords.map((term) => localizeText(term, locale)));
  const [homeLabel, novelsLabel] = await localizeTexts(["首页", "小说"] as const, locale);
  const initialProgress = user
    ? getReadingProgress(user.id, book.id)
    : null;
  const recommendation = user ? getNovelRecommendationState(user.id, book.id) : null;
  const favorite = user ? isNovelFavorite(user.id, book.id) : false;
  const canRecommend = hasUserPermission(user, "novel_feedback");
  const canReport = user?.role === "user" && hasUserPermission(user, "content_report");

  return (
    <main className="readerShell">
      <SiteHeader defaultSearchMode="current" showCurrentSearch readerMode currentUser={user} />

      <article className="readerPage hasReaderPreferences">
        {!user ? <NovelViewTracker novelId={book.id} /> : null}
        <Breadcrumbs
          className="readerBreadcrumbs"
          items={[
            { label: homeLabel, href: "/" },
            { label: novelsLabel, href: safeReturnHref(query.from) },
            { label: displayTitle },
          ]}
        />
        <header className="readerTitle">
          <BookOpenText size={26} aria-hidden="true" />
          <h1>{displayTitle}</h1>
          {user?.role === "admin" ? (
            <AdminReaderActions bookId={book.id} title={displayTitle} isPinned={isNovelPinned(book.id)} />
          ) : null}
        </header>
        <ReaderTagLinks
          tags={tags.map(({ id: tagId, slug }, index) => ({
            id: tagId,
            name: localizedTagNames[index],
            slug,
          }))}
        />
        <Suspense fallback={<ReaderContentLoading />}>
          <ReaderContent
            book={book}
            hitSegment={hitSegment}
            requestHeaders={headerStore}
            user={user}
            locale={locale}
            initialProgress={initialProgress}
            resume={query.resume === "1"}
          />
        </Suspense>
        {user ? (
          <div className="readerFeedbackActions feedbackActionTrio" aria-label="文章操作">
            {canRecommend && recommendation ? (
              <NovelRecommendationButton
                novelId={book.id}
                initialRecommended={recommendation.recommended}
              />
            ) : null}
            <NovelFavoriteButton novelId={book.id} initialFavorite={favorite} />
            {canReport ? <ReportNovelButton novelId={book.id} title={displayTitle} /> : null}
          </div>
        ) : null}
        <ReaderHotwordLinks hotwords={localizedHotwords} novelId={book.id} />
      </article>
    </main>
  );
}
