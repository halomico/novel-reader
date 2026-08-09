import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { NovelReaderView, type NovelReaderQuery } from "@/components/NovelReaderView";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { getNovelById } from "@/lib/books";
import { canAccessNovelLibrary, isGuestLibraryNavEnabled } from "@/lib/config";
import { checkContentAccess } from "@/lib/content-access";
import { languageAlternates, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { getNovelReadAccess } from "@/lib/novel-access";
import {
  getAdjacentNovelChapters,
  getNovelChapter,
  getNovelChapterPosition,
} from "@/lib/novel-library";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
const getBookById = cache(getNovelById);

type ChapterPageProps = {
  params: Promise<{ id: string; chapterId: string }>;
  searchParams: Promise<NovelReaderQuery>;
};

export async function generateMetadata({ params }: ChapterPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const metadataUser = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(metadataUser))) {
    return { title: await localizeText("小说章节", locale), robots: NO_INDEX_ROBOTS };
  }
  const values = await params;
  const bookId = Number(values.id);
  const chapterId = Number(values.chapterId);
  const book = Number.isInteger(bookId) ? getBookById(bookId) : null;
  const chapter = book && Number.isInteger(chapterId) ? getNovelChapter(book.id, chapterId) : null;
  if (!book || !chapter) return { title: await localizeText("章节不存在", locale), robots: NO_INDEX_ROBOTS };
  const title = await localizeText(`${chapter.title} - ${book.title}`, locale);
  const canonicalPath = `/books/${book.id}/chapters/${chapter.id}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const publicAccess = getNovelReadAccess(book, null, { chapterSortOrder: chapter.sortOrder });
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
  const book = getBookById(bookId);
  const chapter = book?.storage_mode === "chapters" ? getNovelChapter(book.id, chapterId) : null;
  if (!book || !chapter) notFound();
  const query = await searchParams;
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label="小说章节" returnTo={`/books/${book.id}/chapters/${chapter.id}`} />;
    }
    notFound();
  }
  const headerStore = await headers();
  const access = checkContentAccess(headerStore, {
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
  const position = getNovelChapterPosition(book.id, chapter);
  const adjacent = getAdjacentNovelChapters(book.id, chapter.sortOrder);
  return (
    <NovelReaderView
      book={book}
      chapterContext={{ chapter, ...position, ...adjacent }}
      query={query}
      requestHeaders={headerStore}
      user={user}
      locale={locale}
      readAccess={getNovelReadAccess(book, user, { chapterSortOrder: chapter.sortOrder })}
    />
  );
}
