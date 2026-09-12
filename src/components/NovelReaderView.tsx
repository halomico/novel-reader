import { ChevronLeft, ChevronRight } from "lucide-react";
import { NovelAccessGate } from "@/components/NovelAccessGate";
import { ReadingProgressTracker } from "@/components/ReadingProgressTracker";
import { ReaderTagLinks } from "@/components/ReaderTagLinks";
import { ReaderExperienceControls } from "@/components/ReaderExperienceControls";
import { ReaderPageTurnController } from "@/components/ReaderPageTurnController";
import { NovelViewTracker } from "@/components/NovelViewTracker";
import { SiteHeader } from "@/components/SiteHeader";
import { AdminReaderActions } from "@/components/AdminReaderActions";
import Link from "@/components/LocalizedLink";
import { database } from "@/core/db/postgres";
import {
  getPostgresNovelSourceById,
  listPostgresNovelChapters,
  listPostgresTagsForNovels,
  type PostgresChapterContext,
  type PostgresPublicNovel,
  type PostgresPublicTag,
} from "@/domains/catalog/postgres-catalog";
import { ContentNotPublishedError, readPublishedNovelContent } from "@/domains/reading/postgres-content";
import { readNovelContentFromSource } from "@/domains/reading/postgres-content-fallback";
import { getPostgresReadingProgress, type PostgresReadingProgress } from "@/domains/reading/postgres-reading-progress";
import { getPostgresNovelInteractionState } from "@/domains/reading/postgres-reader-interactions";
import {
  getPostgresAdjacentReaderNovels,
  isPostgresNovelPinned,
  listPostgresEffectivelyHiddenTagIds,
  listPostgresNovelHotwords,
} from "@/domains/reading/postgres-reader-catalog";
import type { PostgresNovelReadAccess } from "@/domains/reading/postgres-novel-access";
import { hasPostgresUserPermission } from "@/domains/identity/postgres-permissions";
import {
  areGuestHotwordLinksEnabled,
  areHotwordLinksEnabled,
  getReaderAdjacentNovelSort,
  isTagLibraryPublic,
  isTagLibraryEnabled,
} from "@/lib/config";
import type { AppLocale } from "@/lib/locale";
import { localizeNovelSegments, localizeText } from "@/lib/locale-server";
import type { NovelSegment } from "@/lib/segments";
import type { PostgresUserProfile as UserProfile } from "@/domains/identity/postgres-users";
import { normalizeReaderNavigationTitle, splitReaderParagraphs } from "@/lib/reader-layout";

export type NovelReaderQuery = {
  from?: string;
  hit?: string;
  at?: string;
  resume?: string;
};

type ChapterContext = PostgresChapterContext;

function safeReturnHref(value: string | undefined, fallback = "/novels"): string {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : fallback;
}

function ReaderSegments({
  segments,
  hitSegment,
  previousContent,
}: {
  segments: NovelSegment[];
  hitSegment: number;
  previousContent?: string;
}) {
  let previousEndedParagraph = previousContent ? /\r?\n\s*$/.test(previousContent) : true;
  return segments.map((segment) => {
    const continued = !previousEndedParagraph;
    const paragraphs = splitReaderParagraphs(segment.content, continued);
    previousEndedParagraph = /\r?\n\s*$/.test(segment.content);
    const isSearchTarget = segment.segmentIndex === hitSegment;
    return (
      <section
        className="readerSegment"
        data-reader-continuation={continued ? "true" : undefined}
        data-segment-index={segment.segmentIndex}
        data-search-target={isSearchTarget ? "true" : undefined}
        id={`seg-${segment.segmentIndex}`}
        key={segment.segmentIndex}
      >
        {isSearchTarget ? <span id="search-hit" aria-hidden="true" /> : null}
        {paragraphs.map((paragraph, index) => (
          <p
            aria-level={paragraph.sectionHeading ? 2 : undefined}
            className={`readerParagraph${paragraph.continued ? " isContinuation" : ""}${paragraph.sectionHeading ? " isSectionHeading" : ""}`}
            key={index}
            role={paragraph.sectionHeading ? "heading" : undefined}
          >
            {paragraph.text}
          </p>
        ))}
      </section>
    );
  });
}

function ReaderPagedIntro({
  title,
  subtitle,
  tags,
  library,
}: {
  title: string;
  subtitle?: string;
  tags: Array<{ id: number; name: string; slug: string }>;
  library: string;
}) {
  return (
    <header className="readerPagedIntro">
      <h1>{title}</h1>
      {subtitle ? <p>{subtitle}</p> : null}
      <ReaderTagLinks tags={tags} library={library} />
    </header>
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

async function listAllReaderChapters(bookId: number) {
  const executor = database("web");
  const chapters = [] as Awaited<ReturnType<typeof listPostgresNovelChapters>>["items"];
  let cursor: Awaited<ReturnType<typeof listPostgresNovelChapters>>["nextCursor"] = null;
  do {
    const page = await listPostgresNovelChapters(executor, bookId, { limit: 200, ...(cursor ? { cursor } : {}) });
    chapters.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return chapters;
}

function ChapterNavigation({ bookId, context, from }: {
  bookId: number;
  context: ChapterContext;
  from?: string;
}) {
  return (
    <nav className="readerChapterNavigation" aria-label="章节导航">
      {context.previous ? (
        <Link href={chapterHref(bookId, context.previous.id, from)} title={context.previous.title} prefetch={false} scroll>
          <span>上一章</span>
        </Link>
      ) : <span className="isDisabled"><span>上一章</span></span>}
      <span className="readerChapterProgress">{context.index + 1} / {context.total}</span>
      {context.next ? (
        <Link href={chapterHref(bookId, context.next.id, from)} title={context.next.title} prefetch={false} scroll>
          <span>下一章</span>
        </Link>
      ) : <span className="isDisabled"><span>下一章</span></span>}
    </nav>
  );
}

function ReaderNovelNavigation({
  previous,
  next,
  returnHref,
}: {
  previous: { id: number; title: string } | null;
  next: { id: number; title: string } | null;
  returnHref: string;
}) {
  if (!previous && !next) return null;
  const href = (id: number) => `/books/${id}?from=${encodeURIComponent(returnHref)}`;
  const isSingle = Boolean(previous) !== Boolean(next);
  return (
    <nav className={`readerNovelNavigation${isSingle ? " isSingle" : ""}`} aria-label="小说导航">
      {previous ? (
        <Link className="readerNovelLink readerNovelPrevious" href={href(previous.id)} aria-label={`上一篇：${previous.title}`} title={`上一篇：${previous.title}`} prefetch={false} scroll>
          <span className="readerNovelArrow"><ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" /></span>
          <span className="readerNovelTitle"><strong>{previous.title}</strong></span>
        </Link>
      ) : null}
      {next ? (
        <Link className="readerNovelLink readerNovelNext" href={href(next.id)} aria-label={`下一篇：${next.title}`} title={`下一篇：${next.title}`} prefetch={false} scroll>
          <span className="readerNovelTitle"><strong>{next.title}</strong></span>
          <span className="readerNovelArrow"><ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" /></span>
        </Link>
      ) : null}
    </nav>
  );
}

async function ReaderContent({
  book,
  chapterContext,
  hitSegment,
  hitCharOffset,

  user,
  locale,
  initialProgress,
  resume,
  preview,
  previousHref,
  nextHref,
  previousContentBytes,
  nextContentBytes,
  pagedTitle,
  pagedSubtitle,
  pagedTags,
  library,
}: {
  book: PostgresPublicNovel;
  chapterContext: ChapterContext | null;
  hitSegment: number;
  hitCharOffset: number;

  user: UserProfile | null;
  locale: AppLocale;
  initialProgress: PostgresReadingProgress | null;
  resume: boolean;
  preview: boolean;
  previousHref?: string | null;
  nextHref?: string | null;
  previousContentBytes?: number | null;
  nextContentBytes?: number | null;
  pagedTitle: string;
  pagedSubtitle?: string;
  pagedTags: Array<{ id: number; name: string; slug: string }>;
  library: string;
}) {
  const chapter = chapterContext?.chapter || null;
  let published: Awaited<ReturnType<typeof readPublishedNovelContent>>;
  try {
    published = await readPublishedNovelContent(database("web"), {
      novelId: book.id,
      chapterId: chapter?.id,
      previewRatio: preview && !chapter ? 0.3 : 1,
    });
  } catch (error) {
    if (!(error instanceof ContentNotPublishedError)) throw error;
    // Indexing a large library takes hours. Until this book's turn comes, serve it
    // straight from the catalogued source file; search is what is missing, not the text.
    try {
      published = await readNovelContentFromSource(database("web"), {
        novelId: book.id,
        chapterId: chapter?.id,
        previewRatio: preview && !chapter ? 0.3 : 1,
      });
    } catch {
      return (
        <section className="emptyState readerUnavailable" role="status">
          <h2>正文正在准备中</h2>
          <p>这篇内容尚未完成发布，请稍后再试。</p>
        </section>
      );
    }
  }
  const sourceSegments: NovelSegment[] = published.blocks.map((block) => ({
    segmentIndex: block.blockNo,
    charStart: block.charStart,
    charEnd: block.charEnd,
    content: block.originalText,
  }));
  const resolvedHitSegment = Number.isSafeInteger(hitSegment) && hitSegment >= 0
    ? hitSegment
    : Number.isSafeInteger(hitCharOffset) && hitCharOffset >= 0
      ? sourceSegments.find((segment) => segment.charStart <= hitCharOffset && hitCharOffset < segment.charEnd)?.segmentIndex ??
        sourceSegments.find((segment) => segment.charStart >= hitCharOffset)?.segmentIndex ??
        sourceSegments.at(-1)?.segmentIndex ?? Number.NaN
      : Number.NaN;
  const segments = await localizeNovelSegments(
    sourceSegments,
    locale,
    preview && !chapter ? `${published.contentVersion}:soda-preview-30` : published.contentVersion,
  );


  return (
    <>
      <div className="readerPagedStage">
        <div className="readerText">
          <ReaderPagedIntro title={pagedTitle} subtitle={pagedSubtitle} tags={pagedTags} library={library} />
          <ReaderSegments segments={segments} hitSegment={resolvedHitSegment} />
          {/* Locked books stay searchable, so a hit can sit past the free preview. The
              reader then lands on the last free paragraph; say why instead of leaving
              the matched passage silently missing. */}
          {preview && !chapter && Number.isSafeInteger(hitCharOffset) && hitCharOffset >= published.totalUtf16Length ? (
            <p className="readerSearchHitLocked" role="note">搜索命中的段落位于付费部分，解锁后即可继续阅读。</p>
          ) : null}
        </div>
        <ReaderPageTurnController
          previousHref={previousHref}
          nextHref={nextHref}
          previousContentBytes={previousContentBytes}
          nextContentBytes={nextContentBytes}
        />
      </div>
      {user?.readingHistoryEnabled && !preview ? (
        <ReadingProgressTracker
          novelId={book.id}
          chapterId={chapter?.id || null}
          chapterIndex={chapterContext?.index || 0}
          totalChapters={chapterContext?.total || 1}
          userId={user.id}
          contentVersion={published.contentVersion}
          totalSegments={published.blockCount}
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

  user,
  locale,
  readAccess,
}: {
  book: PostgresPublicNovel;
  chapterContext?: ChapterContext | null;
  query: NovelReaderQuery;

  user: UserProfile | null;
  locale: AppLocale;
  readAccess: PostgresNovelReadAccess;
}) {
  const authenticated = Boolean(user);
  const chapter = chapterContext?.chapter || null;
  const preview = readAccess.reason === "preview";
  const hitSegment = Number(query.hit);
  const hitCharOffset = Number(query.at);
  const showTags = isTagLibraryEnabled() && (authenticated || isTagLibraryPublic());
  const showHotwords = readAccess.allowed && !preview && areHotwordLinksEnabled() && (authenticated || areGuestHotwordLinksEnabled());
  const tagAudience = user?.role === "admin" ? "admin" : user ? "member" : "public";
  const executor = database("web");
  const [tagsByNovel, hiddenTagIds, hotwords, source, sourceChapters, adjacentNovels, initialProgress, interaction, canReport, pinned] = await Promise.all([
    showTags
      ? listPostgresTagsForNovels(executor, [book.id], { audience: tagAudience })
      : Promise.resolve(new Map<number, PostgresPublicTag[]>()),
    showTags ? listPostgresEffectivelyHiddenTagIds(executor, user?.id) : Promise.resolve(new Set<number>()),
    showHotwords ? listPostgresNovelHotwords(executor, book.id) : Promise.resolve([]),
    book.sourceId ? getPostgresNovelSourceById(executor, book.sourceId) : Promise.resolve(null),
    book.storageMode === "chapters" ? listAllReaderChapters(book.id) : Promise.resolve([]),
    chapter ? Promise.resolve(null) : getPostgresAdjacentReaderNovels(executor, book, getReaderAdjacentNovelSort()),
    user ? getPostgresReadingProgress(executor, user.id, book.id) : Promise.resolve(null),
    user ? getPostgresNovelInteractionState(executor, user.id, book.id) : Promise.resolve(null),
    user?.role === "user" ? hasPostgresUserPermission(executor, user, "content_report") : Promise.resolve(false),
    user?.role === "admin" ? isPostgresNovelPinned(executor, book.id) : Promise.resolve(false),
  ]);
  const tags = (tagsByNovel.get(book.id) || []).filter((tag) => !hiddenTagIds.has(tag.id));
  const [displayTitle, displayDescription, displayChapterTitle, localizedTagNames, localizedHotwords] = await Promise.all([
    localizeText(book.title, locale),
    book.description ? localizeText(book.description, locale) : Promise.resolve(""),
    chapter ? localizeText(chapter.title, locale) : Promise.resolve(""),
    Promise.all(tags.map((tag) => localizeText(tag.name, locale))),
    Promise.all(hotwords.map((term) => localizeText(term, locale))),
  ]);
  const library = source?.slug || "default";
  const catalogHref = safeReturnHref(
    query.from,
    library === "default" ? "/novels" : `/novels?library=${encodeURIComponent(library)}`,
  );
  const mobileBackHref = catalogHref;
  const chapters = await Promise.all(sourceChapters.map(async (item) => ({
    id: item.id,
    title: await localizeText(item.title, locale),
    wordCount: item.wordCount,
  })));
  const currentSearchBookId = book.storageMode === "chapters" && readAccess.allowed
    ? book.id
    : undefined;
  const [displayPreviousNovel, displayNextNovel] = adjacentNovels
    ? await Promise.all([
        adjacentNovels.previous
          ? localizeText(adjacentNovels.previous.title, locale).then((title) => ({
              id: adjacentNovels.previous!.id,
              title: normalizeReaderNavigationTitle(title),
              sizeBytes: adjacentNovels.previous!.sizeBytes,
            }))
          : null,
        adjacentNovels.next
          ? localizeText(adjacentNovels.next.title, locale).then((title) => ({
              id: adjacentNovels.next!.id,
              title: normalizeReaderNavigationTitle(title),
              sizeBytes: adjacentNovels.next!.sizeBytes,
            }))
          : null,
      ])
    : [null, null];
  const previousReaderHref = chapter
    ? chapterContext?.previous ? chapterHref(book.id, chapterContext.previous.id, query.from) : null
    : displayPreviousNovel ? `/books/${displayPreviousNovel.id}?from=${encodeURIComponent(catalogHref)}` : null;
  const nextReaderHref = chapter
    ? chapterContext?.next ? chapterHref(book.id, chapterContext.next.id, query.from) : null
    : displayNextNovel ? `/books/${displayNextNovel.id}?from=${encodeURIComponent(catalogHref)}` : null;
  const displayTags = tags.map(({ id: tagId, slug }, index) => ({
    id: tagId,
    name: localizedTagNames[index],
    slug,
  }));
  const readerContent = readAccess.allowed
    ? await ReaderContent({
        book,
        chapterContext,
        hitSegment,
        hitCharOffset,

        user,
        locale,
        initialProgress,
        resume: query.resume === "1",
        preview,
        previousHref: previousReaderHref,
        nextHref: nextReaderHref,
        previousContentBytes: chapter
          ? chapterContext?.previous?.sizeBytes
          : displayPreviousNovel?.sizeBytes,
        nextContentBytes: chapter
          ? chapterContext?.next?.sizeBytes
          : displayNextNovel?.sizeBytes,
        pagedTitle: chapter ? displayChapterTitle : displayTitle,
        pagedSubtitle: chapter ? displayTitle : undefined,
        pagedTags: displayTags,
        library,
      })
    : null;

  return (
    <main className="readerShell novelReaderShell">
      <SiteHeader
        defaultSearchMode="current"
        showCurrentSearch
        readerMode
        currentUser={user}
        library={library}
        currentSearchBookId={currentSearchBookId}
        mobileBackHref={mobileBackHref}
        mobileBackLabel="返回小说列表"
      />
      <ReaderExperienceControls
        bookId={book.id}
        title={displayTitle}
        description={displayDescription || undefined}
        chapterTitle={displayChapterTitle || undefined}
        wordCount={book.wordCount}
        chapterCount={book.chapterCount}
        chapters={chapters}
        currentChapterId={chapter?.id}
        navigationKind={chapter ? "chapter" : "novel"}
        previous={chapter
          ? chapterContext?.previous ? { id: chapterContext.previous.id, title: chapterContext.previous.title } : null
          : displayPreviousNovel}
        next={chapter
          ? chapterContext?.next ? { id: chapterContext.next.id, title: chapterContext.next.title } : null
          : displayNextNovel}
        from={query.from}
        returnHref={catalogHref}
        authenticated={authenticated}
        initialInGrove={Boolean(interaction?.planted)}
        initialFavorite={Boolean(interaction?.favorite)}
        canReport={canReport}
      />
      <article className="readerPage hasReaderPreferences" id="reader-content">
        {readAccess.allowed ? <NovelViewTracker novelId={book.id} /> : null}
        <header className="readerTitle">
          <div>
            <h1>{chapter ? displayChapterTitle : displayTitle}</h1>
            {chapter ? <p>{displayTitle}</p> : null}
          </div>
          {user?.role === "admin" ? (
            <AdminReaderActions
              bookId={book.id}
              title={displayTitle}
              isPinned={pinned}
              returnHref={catalogHref}
            />
          ) : null}
        </header>
        <ReaderTagLinks
          tags={displayTags}
          library={library}
        />
        {readAccess.allowed ? (
          <>
            {readerContent}
            {preview ? (
              <NovelAccessGate
                novelId={book.id}
                price={readAccess.price}
                loginRequired={!authenticated}
              />
            ) : null}
            {chapterContext ? (
              <ChapterNavigation bookId={book.id} context={chapterContext} from={query.from} />
            ) : null}
            <ReaderHotwordLinks hotwords={localizedHotwords} novelId={book.id} library={library} />
            {!chapter ? (
              <ReaderNovelNavigation
                previous={displayPreviousNovel}
                next={displayNextNovel}
                returnHref={catalogHref}
              />
            ) : null}
          </>
        ) : (
          <NovelAccessGate
            novelId={book.id}
            price={readAccess.price}
            loginRequired={readAccess.reason === "login_required"}
            notice={Number.isSafeInteger(hitCharOffset)
              ? readAccess.reason === "login_required"
                ? "登录后即可继续阅读搜索命中的段落。"
                : "搜索命中的段落位于付费章节，解锁后即可阅读。"
              : undefined}
          />
        )}
        {!readAccess.allowed ? (
          <ReaderNovelNavigation previous={displayPreviousNovel} next={displayNextNovel} returnHref={catalogHref} />
        ) : null}
      </article>
    </main>
  );
}
