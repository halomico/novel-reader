import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { NovelReaderView, type NovelReaderQuery } from "@/components/NovelReaderView";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { SiteHeader } from "@/components/SiteHeader";
import { getNovelById } from "@/lib/books";
import { canAccessNovelLibrary, isGuestLibraryNavEnabled, isNovelLibraryPublic } from "@/lib/config";
import { checkContentAccess } from "@/lib/content-access";
import { languageAlternates, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { getNovelReadAccess } from "@/lib/novel-access";
import { getFirstNovelChapter, getNovelChapter } from "@/lib/novel-library";
import { getReadingProgress } from "@/lib/reading-progress";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

const getBookById = cache(getNovelById);

type BookPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<NovelReaderQuery>;
};

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const metadataUser = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(metadataUser))) {
    return { title: await localizeText("小说", locale), robots: NO_INDEX_ROBOTS };
  }
  const bookId = Number((await params).id);
  const book = Number.isInteger(bookId) && bookId > 0 ? getBookById(bookId) : null;
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
    robots: isNovelLibraryPublic() ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

function redirectQuery(query: NovelReaderQuery): string {
  const params = new URLSearchParams();
  if (query.from) params.set("from", query.from);
  if (query.hit) params.set("hit", query.hit);
  if (query.resume) params.set("resume", query.resume);
  return params.size ? `?${params.toString()}` : "";
}

export default async function BookPage({ params, searchParams }: BookPageProps) {
  const bookId = Number((await params).id);
  if (!Number.isInteger(bookId) || bookId < 1) notFound();
  const book = getBookById(bookId);
  if (!book) notFound();
  const query = await searchParams;
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      return <ContentEntryGatePage locale={locale} label="小说" returnTo={`/books/${book.id}`} />;
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
  if (book.storage_mode === "chapters") {
    const progress = user ? getReadingProgress(user.id, book.id) : null;
    const savedChapter = progress?.chapterId ? getNovelChapter(book.id, progress.chapterId) : null;
    const chapter = savedChapter || getFirstNovelChapter(book.id);
    if (!chapter) notFound();
    redirect(`/books/${book.id}/chapters/${chapter.id}${redirectQuery(query)}`);
  }
  return (
    <NovelReaderView
      book={book}
      query={query}
      requestHeaders={headerStore}
      user={user}
      locale={locale}
      readAccess={getNovelReadAccess(book, user, { contentPreview: true })}
    />
  );
}
