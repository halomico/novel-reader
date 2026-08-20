import { ChevronRight, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContextNavigationLink } from "@/components/ContextNavigationLink";
import { formatNovelUpdateTime, formatNovelWordCount } from "@/components/CatalogBookGrid";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { SiteHeader } from "@/components/SiteHeader";
import { getNovelById } from "@/lib/books";
import { canAccessNovelLibrary, canConsumeNovelLibrary, isGuestLibraryNavEnabled, isNovelLibraryPublic } from "@/lib/config";
import { checkContentAccess } from "@/lib/content-access";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { getNovelPreviewChapterCount, getNovelReadAccess } from "@/lib/novel-access";
import { getNovelSourceById, listNovelChaptersPage } from "@/lib/novel-library";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const locale = await getRequestLocale();
  const metadataUser = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(metadataUser))) {
    return { title: await localizeText("小说章节", locale), robots: NO_INDEX_ROBOTS };
  }
  const book = getNovelById(Number((await params).id));
  return book
    ? { title: await localizeText(`${book.title} - 章节`, locale), robots: isNovelLibraryPublic() ? undefined : NO_INDEX_ROBOTS }
    : { title: await localizeText("章节不存在", locale), robots: NO_INDEX_ROBOTS };
}

export default async function NovelChaptersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string; from?: string }>;
}) {
  const bookId = Number((await params).id);
  const book = Number.isInteger(bookId) ? getNovelById(bookId) : null;
  if (!book || book.storage_mode !== "chapters") notFound();
  const query = await searchParams;
  const user = await getCurrentUser();
  if (!canAccessNovelLibrary(Boolean(user))) {
    if (!user && isGuestLibraryNavEnabled()) {
      const locale = await getRequestLocale();
      return <ContentEntryGatePage locale={locale} label="小说章节" returnTo={`/books/${book.id}/chapters`} />;
    }
    notFound();
  }
  const requestHeaders = await headers();
  const access = checkContentAccess(requestHeaders, {
    scope: "novel",
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const result = listNovelChaptersPage(book.id, Number(query.page || 1), 100);
  const library = book.source_id ? getNovelSourceById(book.source_id)?.slug || "default" : "default";
  const locale = await getRequestLocale();
  const [homeLabel, novelsLabel, chaptersLabel] = await localizeTexts(["首页", "小说", "章节"] as const, locale);
  const displayTitle = await localizeText(book.title, locale);
  const displayChapters = await Promise.all(result.chapters.map(async (chapter) => ({
    ...chapter,
    title: await localizeText(chapter.title, locale),
  })));
  const previewChapterCount = getNovelPreviewChapterCount(book);
  const fullAccess = getNovelReadAccess(book, user, { chapterSortOrder: previewChapterCount }).allowed;
  const previewAvailable = canConsumeNovelLibrary(Boolean(user)) && previewChapterCount > 0;
  const returnQuery = query.from ? `?from=${encodeURIComponent(query.from)}` : "";

  return (
    <main className="siteShell novelChapterCatalogShell">
      <SiteHeader currentUser={user} library={library} />
      <div className="pageContent novelChapterCatalog">
        <Breadcrumbs items={[
          { label: homeLabel, href: "/" },
          { label: novelsLabel, href: query.from || "/novels" },
          { label: displayTitle, href: `/books/${book.id}` },
          { label: chaptersLabel },
        ]} />
        <header className="novelChapterCatalogHeader">
          <h1>{displayTitle}</h1>
          <ResultCount count={result.totalChapters} unit="章" />
        </header>
        <section className="novelChapterGrid" aria-label={`${displayTitle}章节`}>
          {displayChapters.map((chapter) => {
            const locked = !fullAccess && !(previewAvailable && chapter.sortOrder < previewChapterCount);
            return (
              <ContextNavigationLink
                className={locked ? "novelChapterCard isLocked" : "novelChapterCard"}
                contextReturnHref={`/books/${book.id}/chapters${returnQuery}`}
                href={`/books/${book.id}/chapters/${chapter.id}${returnQuery}`}
                prefetch={false}
                key={chapter.id}
              >
                <span className="novelChapterCardMain">
                  <span>{chapter.title}</span>
                  {locked
                    ? <LockKeyhole size={14} aria-label="需要解锁" />
                    : <ChevronRight size={14} aria-hidden="true" />}
                </span>
                <span className="novelChapterCardMeta">
                  <small>{formatNovelWordCount(chapter.wordCount)}</small>
                  {"\u00A0\u00A0"}
                  <small>更新于 {formatNovelUpdateTime({ mtime_ms: chapter.mtimeMs, updated_at: chapter.updatedAt })}</small>
                </span>
              </ContextNavigationLink>
            );
          })}
        </section>
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          query=""
          basePath={`/books/${book.id}/chapters`}
          extraParams={{ from: query.from }}
        />
      </div>
    </main>
  );
}
