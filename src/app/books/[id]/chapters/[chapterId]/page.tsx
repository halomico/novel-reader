import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { NovelReaderView, type NovelReaderQuery } from "@/components/NovelReaderView";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import { getPostgresChapterContext, getPostgresPublicNovel } from "@/domains/catalog/postgres-catalog";
import { getPostgresNovelReadAccess } from "@/domains/reading/postgres-novel-access";
import { isGuestLibraryNavEnabled } from "@/lib/config";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { languageAlternates, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
const getBookById = cache((id: number) => getPostgresPublicNovel(database("web"), id));
const getChapterContext = cache((bookId: number, chapterId: number) =>
  getPostgresChapterContext(database("web"), bookId, chapterId));

type ChapterPageProps = {
  params: Promise<{ id: string; chapterId: string }>;
  searchParams: Promise<NovelReaderQuery>;
};

export async function generateMetadata({ params }: ChapterPageProps): Promise<Metadata> {
  const [locale, metadataUser, settings] = await Promise.all([
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
  ]);
  if (!canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(metadataUser))) {
    return { title: await localizeText("小说章节", locale), robots: NO_INDEX_ROBOTS };
  }
  const values = await params;
  const bookId = Number(values.id);
  const chapterId = Number(values.chapterId);
  const book = Number.isInteger(bookId) && bookId > 0 ? await getBookById(bookId) : null;
  const chapterContext = book && Number.isInteger(chapterId) && chapterId > 0
    ? await getChapterContext(book.id, chapterId)
    : null;
  const chapter = chapterContext?.chapter || null;
  if (!book || !chapter) return { title: await localizeText("章节不存在", locale), robots: NO_INDEX_ROBOTS };
  const title = await localizeText(`${chapter.title} - ${book.title}`, locale);
  const canonicalPath = `/books/${book.id}/chapters/${chapter.id}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const publicAccess = await getPostgresNovelReadAccess(
    database("web"), book, null, settings.homePortalAccessModes.novels,
    {
      storageMode: book.storageMode,
      chapterCount: book.chapterCount,
      previewChapterCount: book.previewChapterCount,
      chapterSortOrder: chapter.sortOrder,
    },
  );
  return {
    title,
    description: await localizeText(`在线阅读《${book.title}》${chapter.title}。`, locale),
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    openGraph: { type: "article", title, url: canonical },
    robots: publicAccess.allowed ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

export default async function ChapterPage({ params, searchParams }: ChapterPageProps) {
  const values = await params;
  const bookId = Number(values.id);
  const chapterId = Number(values.chapterId);
  if (!Number.isInteger(bookId) || !Number.isInteger(chapterId) || bookId < 1 || chapterId < 1) notFound();
  const book = await getBookById(bookId);
  const chapterContext = book?.storageMode === "chapters" ? await getChapterContext(book.id, chapterId) : null;
  const chapter = chapterContext?.chapter || null;
  if (!book || !chapter || !chapterContext) notFound();
  const query = await searchParams;
  const [locale, user, settings] = await Promise.all([
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
  ]);
  if (!canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label="小说章节" returnTo={`/books/${book.id}/chapters/${chapter.id}`} />;
    }
    notFound();
  }
  const headerStore = await headers();
  const access = await checkPostgresContentAccess(database("web"), headerStore, {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
  });
  if (!access.allowed) {
    return (
      <main className="readerShell">
        <SiteHeader currentUser={user} />
        <section className="emptyState"><h2>{access.message}</h2></section>
      </main>
    );
  }
  return (
    <NovelReaderView
      book={book}
      chapterContext={chapterContext}
      query={query}
      user={user}
      locale={locale}
      readAccess={await getPostgresNovelReadAccess(
        database("web"), book, user, settings.homePortalAccessModes.novels,
        {
          storageMode: book.storageMode,
          chapterCount: book.chapterCount,
          previewChapterCount: book.previewChapterCount,
          chapterSortOrder: chapter.sortOrder,
        },
      )}
    />
  );
}
