import { after } from "next/server";
import { Suspense } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { NovelAccessGate } from "@/components/NovelAccessGate";
import { ReadingProgressTracker } from "@/components/ReadingProgressTracker";
import { ReaderTagLinks } from "@/components/ReaderTagLinks";
import { ReaderExperienceControls } from "@/components/ReaderExperienceControls";
import { NovelViewTracker } from "@/components/NovelViewTracker";
import { SiteHeader } from "@/components/SiteHeader";
import { AdminReaderActions } from "@/components/AdminReaderActions";
import Link from "@/components/LocalizedLink";
import { getClientIp } from "@/lib/admin-access";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { readNovelSegments, type Novel } from "@/lib/books";
import {
  areGuestHotwordLinksEnabled,
  areHotwordLinksEnabled,
  isTagLibraryPublic,
  isTagLibraryEnabled,
} from "@/lib/config";
import { isNovelFavorite } from "@/lib/favorites";
import { getNovelGroveState } from "@/lib/grove";
import type { AppLocale } from "@/lib/locale";
import { localizeNovelSegments, localizeText, localizeTexts } from "@/lib/locale-server";
import { getNovelReadAccess, getSodaNovelPreviewSegments, type NovelReadAccess } from "@/lib/novel-access";
import {
  novelChapterContentVersion,
  getNovelSourceById,
  listNovelChapters,
  readNovelChapterSegments,
  type NovelChapter,
} from "@/lib/novel-library";
import { getReadingProgress, novelContentVersion, type ReadingProgress } from "@/lib/reading-progress";
import { getNovelRecommendationState } from "@/lib/recommendations";
import { isNovelPinned } from "@/lib/pinned-novels";
import { filterTagsForUser } from "@/lib/tag-preferences";
import { listHotwordsForNovel, listTagsForNovel } from "@/lib/tags";
import { hasUserPermission } from "@/lib/user-levels";
import type { UserProfile } from "@/lib/users";
import { recordNovelVisit, recordReadingHistory } from "@/lib/users";

export type NovelReaderQuery = {
  from?: string;
  hit?: string;
  resume?: string;
};

type ChapterContext = {
  chapter: NovelChapter;
  index: number;
  total: number;
  previous: NovelChapter | null;
  next: NovelChapter | null;
};

function safeReturnHref(value: string | undefined, fallback = "/novels"): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

function ReaderContentLoading() {
  return (
    <div className="readerContentLoading" role="status" aria-label="正文加载中">
      {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
    </div>
  );
}

function ReaderHotwordLinks({ hotwords, novelId, library }: { hotwords: string[]; novelId: number; library: string }) {
  if (!hotwords.length) return null;
  return (
    <nav className="readerHotwordLinks" aria-label="文末热词">
      {hotwords.map((term) => (
        <Link href={`/search?q=${encodeURIComponent(term)}&source=reader_hotword&origin=${novelId}${library === "default" ? "" : `&library=${encodeURIComponent(library)}`}`} key={term}>
          {term}
        </Link>
      ))}
    </nav>
  );
}

function chapterHref(bookId: number, chapterId: number, from?: string): string {
  const query = from ? `?from=${encodeURIComponent(from)}` : "";
  return `/books/${bookId}/chapters/${chapterId}${query}`;
}

function ChapterNavigation({ bookId, context, from }: {
  bookId: number;
  context: ChapterContext;
  from?: string;
}) {
  return (
    <nav className="readerChapterNavigation" aria-label="章节导航">
      {context.previous ? (
        <Link href={chapterHref(bookId, context.previous.id, from)} title={context.previous.title}>
          <span>上一章</span>
        </Link>
      ) : <span className="isDisabled"><span>上一章</span></span>}
      <span className="readerChapterProgress">{context.index + 1} / {context.total}</span>
      {context.next ? (
        <Link href={chapterHref(bookId, context.next.id, from)} title={context.next.title}>
          <span>下一章</span>
        </Link>
      ) : <span className="isDisabled"><span>下一章</span></span>}
    </nav>
  );
}

async function ReaderContent({
  book,
  chapterContext,
  hitSegment,
  requestHeaders,
  user,
  locale,
  initialProgress,
  resume,
  preview,
}: {
  book: Novel;
  chapterContext: ChapterContext | null;
  hitSegment: number;
  requestHeaders: Headers;
  user: UserProfile | null;
  locale: AppLocale;
  initialProgress: ReadingProgress | null;
  resume: boolean;
  preview: boolean;
}) {
  const chapter = chapterContext?.chapter || null;
  const sourceSegments = chapter ? await readNovelChapterSegments(chapter) : await readNovelSegments(book);
  const contentVersion = chapter ? novelChapterContentVersion(chapter) : novelContentVersion(book);
  const readableSegments = preview && !chapter ? getSodaNovelPreviewSegments(sourceSegments) : sourceSegments;
  const segments = await localizeNovelSegments(
    readableSegments,
    locale,
    preview && !chapter ? `${contentVersion}:soda-preview-30` : contentVersion,
  );
  const path = chapter ? `/books/${book.id}/chapters/${chapter.id}` : `/books/${book.id}`;
  if (user) {
    after(() => {
      recordNovelVisit(book.id, getClientIp(requestHeaders), requestHeaders.get("user-agent") || "");
      recordAnalyticsEvent({
        headers: requestHeaders,
        userId: user.id,
        eventType: "book_view",
        path,
        referrer: requestHeaders.get("referer"),
        novelId: book.id,
      });
      recordReadingHistory(user.id, book, hitSegment, { chapterId: chapter?.id || null, contentVersion });
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
      {user && !preview ? (
        <ReadingProgressTracker
          novelId={book.id}
          chapterId={chapter?.id || null}
          chapterIndex={chapterContext?.index || 0}
          totalChapters={chapterContext?.total || 1}
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

export async function NovelReaderView({
  book,
  chapterContext = null,
  query,
  requestHeaders,
  user,
  locale,
  readAccess,
}: {
  book: Novel;
  chapterContext?: ChapterContext | null;
  query: NovelReaderQuery;
  requestHeaders: Headers;
  user: UserProfile | null;
  locale: AppLocale;
  readAccess: NovelReadAccess;
}) {
  const authenticated = Boolean(user);
  const chapter = chapterContext?.chapter || null;
  const preview = readAccess.reason === "preview";
  const hitSegment = Number(query.hit);
  const showTags = isTagLibraryEnabled() && (authenticated || isTagLibraryPublic());
  const showHotwords = readAccess.allowed && !preview && areHotwordLinksEnabled() && (authenticated || areGuestHotwordLinksEnabled());
  const tagAudience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const sourceTags = showTags ? listTagsForNovel(book.id, { audience: tagAudience }) : [];
  const tags = filterTagsForUser(sourceTags, user?.id);
  const hotwords = showHotwords ? listHotwordsForNovel(book.id) : [];
  const displayTitle = await localizeText(book.title, locale);
  const displayDescription = book.description ? await localizeText(book.description, locale) : "";
  const displayChapterTitle = chapter ? await localizeText(chapter.title, locale) : "";
  const localizedTagNames = await Promise.all(tags.map((tag) => localizeText(tag.name, locale)));
  const localizedHotwords = await Promise.all(hotwords.map((term) => localizeText(term, locale)));
  const [homeLabel, novelsLabel] = await localizeTexts(["首页", "小说"] as const, locale);
  const initialProgress = user ? getReadingProgress(user.id, book.id) : null;
  const recommendation = user ? getNovelRecommendationState(user.id, book.id) : null;
  const grove = user ? getNovelGroveState(user.id, book.id) : null;
  const favorite = user ? isNovelFavorite(user.id, book.id) : false;
  const canRecommend = hasUserPermission(user, "novel_feedback");
  const canReport = user?.role === "user" && hasUserPermission(user, "content_report");
  const library = book.source_id ? getNovelSourceById(book.source_id)?.slug || "default" : "default";
  const catalogHref = safeReturnHref(
    query.from,
    library === "default" ? "/novels" : `/novels?library=${encodeURIComponent(library)}`,
  );
  const chapterCatalogHref = `/books/${book.id}/chapters${query.from ? `?from=${encodeURIComponent(query.from)}` : ""}`;
  const mobileBackHref = chapter ? chapterCatalogHref : catalogHref;
  const sourceChapters = book.storage_mode === "chapters" ? listNovelChapters(book.id) : [];
  const chapters = await Promise.all(sourceChapters.map(async (item) => ({
    id: item.id,
    title: await localizeText(item.title, locale),
    wordCount: item.wordCount,
  })));
  const currentSearchBookId = book.storage_mode === "chapters" && getNovelReadAccess(book, user).allowed
    ? book.id
    : undefined;

  return (
    <main className="readerShell">
      <SiteHeader
        defaultSearchMode="current"
        showCurrentSearch
        readerMode
        currentUser={user}
        library={library}
        currentSearchBookId={currentSearchBookId}
        mobileBackHref={mobileBackHref}
        mobileBackLabel={chapter ? "返回章节目录" : "返回小说列表"}
      />
      <ReaderExperienceControls
        bookId={book.id}
        title={displayTitle}
        description={displayDescription || undefined}
        chapterTitle={displayChapterTitle || undefined}
        wordCount={book.word_count}
        chapterCount={book.chapter_count}
        chapters={chapters}
        currentChapterId={chapter?.id}
        previous={chapterContext?.previous ? { id: chapterContext.previous.id, title: chapterContext.previous.title, wordCount: chapterContext.previous.wordCount } : null}
        next={chapterContext?.next ? { id: chapterContext.next.id, title: chapterContext.next.title, wordCount: chapterContext.next.wordCount } : null}
        from={query.from}
        authenticated={authenticated}
        canRecommend={canRecommend}
        initialRecommended={Boolean(recommendation?.recommended)}
        initialInGrove={Boolean(grove?.planted)}
        initialFavorite={favorite}
        canReport={canReport}
      />
      <article className="readerPage hasReaderPreferences">
        {!user && readAccess.allowed ? <NovelViewTracker novelId={book.id} /> : null}
        <Breadcrumbs
          className="readerBreadcrumbs"
          items={[
            { label: homeLabel, href: "/" },
            { label: novelsLabel, href: catalogHref },
            chapter ? { label: displayTitle, href: `/books/${book.id}/chapters` } : { label: displayTitle },
            ...(chapter ? [{ label: displayChapterTitle }] : []),
          ]}
        />
        <header className="readerTitle">
          <div>
            <h1>{chapter ? displayChapterTitle : displayTitle}</h1>
            {chapter ? <p>{displayTitle}</p> : null}
          </div>
          {user?.role === "admin" ? (
            <AdminReaderActions
              bookId={book.id}
              title={displayTitle}
              isPinned={isNovelPinned(book.id)}
              returnHref={catalogHref}
            />
          ) : null}
        </header>
        <ReaderTagLinks
          tags={tags.map(({ id: tagId, slug }, index) => ({ id: tagId, name: localizedTagNames[index], slug }))}
          library={library}
        />
        {readAccess.allowed ? (
          <Suspense fallback={<ReaderContentLoading />}>
            <ReaderContent
              book={book}
              chapterContext={chapterContext}
              hitSegment={hitSegment}
              requestHeaders={requestHeaders}
              user={user}
              locale={locale}
              initialProgress={initialProgress}
              resume={query.resume === "1"}
              preview={preview}
            />
          </Suspense>
        ) : (
          <NovelAccessGate
            novelId={book.id}
            price={readAccess.price}
            loginRequired={readAccess.reason === "login_required"}
          />
        )}
        {preview ? (
          <NovelAccessGate
            novelId={book.id}
            price={readAccess.price}
            loginRequired={!authenticated}
            preview
          />
        ) : null}
        {chapterContext && readAccess.allowed ? (
          <ChapterNavigation bookId={book.id} context={chapterContext} from={query.from} />
        ) : null}
        <ReaderHotwordLinks hotwords={localizedHotwords} novelId={book.id} library={library} />
      </article>
    </main>
  );
}
