import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { NovelReaderView, type NovelReaderQuery } from "@/components/NovelReaderView";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import { checkPostgresContentAccess } from "@/domains/access/postgres-content-access";
import {
  getPostgresChapterContext,
  getPostgresFirstNovelChapter,
  getPostgresPublicNovel,
} from "@/domains/catalog/postgres-catalog";
import { getPostgresNovelReadAccess } from "@/domains/reading/postgres-novel-access";
import { getPostgresReadingProgress } from "@/domains/reading/postgres-reading-progress";
import { isGuestLibraryNavEnabled } from "@/lib/config";
import { canBrowseHomePortal } from "@/lib/home-portal";
import { languageAlternates, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

const getBookById = cache((id: number) => getPostgresPublicNovel(database("web"), id));

type BookPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<NovelReaderQuery>;
};

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const [locale, metadataUser, settings] = await Promise.all([
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
  ]);
  if (!canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(metadataUser))) {
    return { title: await localizeText("小说", locale), robots: NO_INDEX_ROBOTS };
  }
  const bookId = Number((await params).id);
  const book = Number.isInteger(bookId) && bookId > 0 ? await getBookById(bookId) : null;
  if (!book) return { title: await localizeText("小说不存在", locale), robots: NO_INDEX_ROBOTS };
  const title = await localizeText(book.title, locale);
  const canonicalPath = `/books/${book.id}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const description = await localizeText(`在线阅读《${book.title}》。`, locale);
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    openGraph: { type: "article", title, description, url: canonical },
    robots: canBrowseHomePortal(settings.homePortalAccessModes.novels, false) ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

function redirectQuery(query: NovelReaderQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.hit) params.set("hit", query.hit);
  if (query.at) params.set("at", query.at);
  if (query.resume) params.set("resume", query.resume);
  return params.size ? `?${params.toString()}` : "";
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const bookId = Number((await params).id);
  if (!Number.isInteger(bookId) || bookId < 1) notFound();
  const book = await getBookById(bookId);
  if (!book) notFound();
  const query = await searchParams;
  const [locale, user, settings] = await Promise.all([
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
  ]);
  if (!canBrowseHomePortal(settings.homePortalAccessModes.novels, Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label="小说" returnTo={`/books/${book.id}`} />;
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
  if (book.storageMode === "chapters") {
    const progress = user ? await getPostgresReadingProgress(database("web"), user.id, book.id) : null;
    const savedChapter = progress?.chapterId
      ? (await getPostgresChapterContext(database("web"), book.id, progress.chapterId))?.chapter || null
      : null;
    const chapter = savedChapter || await getPostgresFirstNovelChapter(database("web"), book.id);
    if (!chapter) notFound();
    redirect(`/books/${book.id}/chapters/${chapter.id}${redirectQuery(query)}`);
  }
  return (
    <NovelReaderView
      book={book}
      query={query}
      user={user}
      locale={locale}
      readAccess={await getPostgresNovelReadAccess(
        database("web"), book, user, settings.homePortalAccessModes.novels,
        {
          storageMode: book.storageMode,
          chapterCount: book.chapterCount,
          previewChapterCount: book.previewChapterCount,
          contentPreview: true,
        },
      )}
    />
  );
}
