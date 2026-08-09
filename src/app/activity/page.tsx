import { Activity, Disc3 } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { CatalogBookCard } from "@/components/CatalogBookGrid";
import {
  FavoriteSelectableItem,
  FavoriteSelectionManager,
} from "@/components/FavoriteSelectionManager";
import Link from "@/components/LocalizedLink";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { Pagination } from "@/components/Pagination";
import { ReadingHistoryList } from "@/components/ReadingHistoryList";
import { ResultCount } from "@/components/ResultCount";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getVideoThumbnailSettings, isTagLibraryEnabled } from "@/lib/config";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { listFavoriteMedia, listFavoriteNovels } from "@/lib/favorites";
import { isMediaKindPublic } from "@/lib/media";
import { formatMediaDuration } from "@/lib/media-format";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { listReadingProgressPage } from "@/lib/reading-progress";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { filterTagsByNovelForUser } from "@/lib/tag-preferences";
import { listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";
const ACTIVITY_PAGE_SIZE = 50;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return { title: uiText(locale, "动态"), robots: NO_INDEX_ROBOTS };
}

function displayMediaTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase())
    ? title.slice(0, -extension.length)
    : title;
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; type?: string; view?: string }>;
}) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!user) redirect(withLocalePath("/login?returnTo=/activity", locale));
  const params = await searchParams;
  const view = params.view === "favorites" ? "favorites" : "recent";
  const mediaKind = params.type === "videos" ? "video" : params.type === "audio" ? "audio" : null;
  const access = checkContentAccess(await headers(), {
    scope: mediaKind || "novel",
    authenticated: true,
    admin: user.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  const recent = view === "recent"
    ? user.readingHistoryEnabled
      ? listReadingProgressPage(user.id, {
          page: Number(params.page || 1),
          pageSize: ACTIVITY_PAGE_SIZE,
        })
      : {
          items: [],
          page: 1,
          pageSize: ACTIVITY_PAGE_SIZE,
          totalItems: 0,
          totalPages: 1,
        }
    : null;
  const novelResult = view === "favorites" && !mediaKind
    ? listFavoriteNovels(user.id, Number(params.page || 1), ACTIVITY_PAGE_SIZE)
    : null;
  const mediaResult = view === "favorites" && mediaKind
    ? listFavoriteMedia(user.id, mediaKind, Number(params.page || 1), ACTIVITY_PAGE_SIZE)
    : null;
  const sourceTags = novelResult && isTagLibraryEnabled()
    ? listTagsForNovels(
        novelResult.books.map((book) => book.id),
        { audience: user.role === "admin" ? "admin" : "member" },
      )
    : new Map();
  const tagsByNovel = filterTagsByNovelForUser(sourceTags, user.id);
  const displayRecent = recent
    ? {
        ...recent,
        items: await Promise.all(recent.items.map(async (item) => ({
          ...item,
          title: await localizeText(item.title, locale),
        }))),
      }
    : null;
  const displayNovelResult = novelResult
    ? {
        ...novelResult,
        books: await Promise.all(novelResult.books.map(async (book) => ({
          ...book,
          title: await localizeText(book.title, locale),
        }))),
      }
    : null;
  const displayMediaResult = mediaResult
    ? {
        ...mediaResult,
        assets: await Promise.all(mediaResult.assets.map(async (asset) => ({
          ...asset,
          title: await localizeText(asset.title, locale),
          artist: asset.artist ? await localizeText(asset.artist, locale) : asset.artist,
        }))),
      }
    : null;
  const displayTagsByNovel = new Map(
    await Promise.all(Array.from(tagsByNovel, async ([novelId, tags]) => [
      novelId,
      await Promise.all(tags.map(async (tag) => ({
        ...tag,
        name: await localizeText(tag.name, locale),
      }))),
    ] as const)),
  );
  const thumbnailSettings = getVideoThumbnailSettings();
  const directThumbnails = mediaKind === "video" && !hasScopedContentAccessRules("video");
  const publiclyAccessibleThumbnails = directThumbnails && isMediaKindPublic("video");
  const total = recent?.totalItems ?? mediaResult?.totalAssets ?? novelResult?.totalBooks ?? 0;
  const [
    activityLabel,
    recentLabel,
    favoritesLabel,
    personalContentLabel,
    favoriteTypeLabel,
    novelsLabel,
    videosLabel,
    audioLabel,
  ] = await localizeTexts(
    ["动态", "最近", "收藏", "个人内容", "收藏类型", "小说", "视频", "音频"] as const,
    locale,
  );

  return (
    <UserWorkspace user={user} active="activity" breadcrumb={activityLabel}>
      <section className="activityLibrary">
        <header className="userContentHeader">
          <span><Activity size={19} aria-hidden="true" /><h1>{activityLabel}</h1></span>
          {view === "recent" && !user.readingHistoryEnabled ? null : <ResultCount count={total} />}
        </header>
        <nav className="messagesTabs activityTabs" aria-label={personalContentLabel}>
          <Link className={view === "recent" ? "isActive" : ""} href="/activity">{recentLabel}</Link>
          <Link className={view === "favorites" ? "isActive" : ""} href="/activity?view=favorites">{favoritesLabel}</Link>
        </nav>

        {displayRecent ? (
          <ReadingHistoryList
            initialItems={displayRecent.items}
            page={displayRecent.page}
            totalPages={displayRecent.totalPages}
            locale={locale}
            historyEnabled={user.readingHistoryEnabled}
          />
        ) : (
          <>
            <nav className="messagesTabs favoriteTabs" aria-label={favoriteTypeLabel}>
              <Link className={!mediaKind ? "isActive" : ""} href="/activity?view=favorites">{novelsLabel}</Link>
              <Link className={mediaKind === "video" ? "isActive" : ""} href="/activity?view=favorites&type=videos">{videosLabel}</Link>
              <Link className={mediaKind === "audio" ? "isActive" : ""} href="/activity?view=favorites&type=audio">{audioLabel}</Link>
            </nav>
            {displayNovelResult?.books.length ? (
              <FavoriteSelectionManager
                kind="novel"
                visibleIds={displayNovelResult.books.map((book) => book.id)}
                locale={locale}
              >
                <section className="bookGrid favoriteBookGrid" aria-label={uiText(locale, "收藏小说")}>
                  {displayNovelResult.books.map((book) => (
                    <FavoriteSelectableItem id={book.id} label={book.title} key={book.id}>
                      <CatalogBookCard
                        book={book}
                        returnHref={`/activity?view=favorites&page=${displayNovelResult.page}`}
                        tags={displayTagsByNovel.get(book.id) || []}
                      />
                    </FavoriteSelectableItem>
                  ))}
                </section>
              </FavoriteSelectionManager>
            ) : mediaKind === "video" && displayMediaResult?.assets.length ? (
              <FavoriteSelectionManager
                kind="video"
                visibleIds={displayMediaResult.assets.map((asset) => asset.id)}
                locale={locale}
              >
                <div className="mediaAssetGrid is-video favoriteVideoGrid">
                  {displayMediaResult.assets.map((asset, index) => (
                    <FavoriteSelectableItem id={asset.id} label={asset.title} key={asset.id}>
                      <MediaVideoCard
                        asset={asset}
                        thumbnail={thumbnailSettings}
                        thumbnailUrl={directThumbnails
                          ? directMediaThumbnailUrl(asset, thumbnailSettings.singlePercent, publiclyAccessibleThumbnails)
                          : null}
                        priority={index === 0}
                        eager={index < 6}
                      />
                    </FavoriteSelectableItem>
                  ))}
                </div>
              </FavoriteSelectionManager>
            ) : mediaKind === "audio" && displayMediaResult?.assets.length ? (
              <FavoriteSelectionManager
                kind="audio"
                visibleIds={displayMediaResult.assets.map((asset) => asset.id)}
                locale={locale}
              >
                <div className="mediaResourceList favoriteAudioList">
                  {displayMediaResult.assets.map((asset) => {
                    const title = displayMediaTitle(asset.title, asset.fileName);
                    return (
                      <FavoriteSelectableItem id={asset.id} label={title} key={asset.id}>
                        <Link className="mediaResourceRow" href={`/media/${asset.id}`}>
                          <span className="mediaAssetIcon is-audio" aria-hidden="true"><Disc3 size={21} /></span>
                          <span className="mediaCardCopy">
                            <strong title={title}>{title}</strong>
                            <small>{asset.artist || uiText(locale, "未知作者")}</small>
                          </span>
                          <span className="mediaCardSize">{formatMediaDuration(asset.durationSeconds)}</span>
                        </Link>
                      </FavoriteSelectableItem>
                    );
                  })}
                </div>
              </FavoriteSelectionManager>
            ) : (
              <div className="messageEmpty favoriteEmpty">
                {mediaKind === "video"
                  ? uiText(locale, "还没有收藏视频")
                  : mediaKind === "audio"
                    ? uiText(locale, "还没有收藏音频")
                    : uiText(locale, "还没有收藏小说")}
              </div>
            )}
            {novelResult ? (
              <Pagination
                page={novelResult.page}
                totalPages={novelResult.totalPages}
                query=""
                basePath="/activity"
                extraParams={{ view: "favorites" }}
              />
            ) : mediaResult ? (
              <Pagination
                page={mediaResult.page}
                totalPages={mediaResult.totalPages}
                query=""
                basePath="/activity"
                extraParams={{
                  view: "favorites",
                  type: mediaKind === "audio" ? "audio" : "videos",
                }}
              />
            ) : null}
          </>
        )}
      </section>
    </UserWorkspace>
  );
}
