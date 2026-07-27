import { Bookmark, ChevronRight, Disc3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatalogBookGrid } from "@/components/CatalogBookGrid";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { Pagination } from "@/components/Pagination";
import { ResultCount } from "@/components/ResultCount";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getCatalogPageSize, getVideoThumbnailSettings, isTagLibraryEnabled } from "@/lib/config";
import { hasScopedContentAccessRules } from "@/lib/content-access";
import { listFavoriteMedia, listFavoriteNovels } from "@/lib/favorites";
import { isMediaKindPublic } from "@/lib/media";
import { formatMediaDuration } from "@/lib/media-format";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { filterTagsByNovelForUser } from "@/lib/tag-preferences";
import { listTagsForNovels } from "@/lib/tags";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "收藏", robots: NO_INDEX_ROBOTS };

function displayMediaTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase()) ? title.slice(0, -extension.length) : title;
}

export default async function FavoritesPage({ searchParams }: { searchParams: Promise<{ page?: string; type?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const mediaKind = params.type === "videos" ? "video" : params.type === "audio" ? "audio" : null;
  const novelResult = mediaKind ? null : listFavoriteNovels(user.id, Number(params.page || 1), getCatalogPageSize());
  const mediaResult = mediaKind
    ? listFavoriteMedia(user.id, mediaKind, Number(params.page || 1), mediaKind === "audio" ? 50 : 30)
    : null;
  const sourceTags = novelResult && isTagLibraryEnabled()
    ? listTagsForNovels(novelResult.books.map((book) => book.id), { audience: user.role === "admin" ? "admin" : "member" })
    : new Map();
  const tagsByNovel = filterTagsByNovelForUser(sourceTags, user.id);
  const thumbnailSettings = getVideoThumbnailSettings();
  const directThumbnails = mediaKind === "video" && !hasScopedContentAccessRules("media");
  const publiclyAccessibleThumbnails = directThumbnails && isMediaKindPublic("video");

  return (
    <UserWorkspace user={user} active="favorites" breadcrumb="收藏">
      <section className="favoriteLibrary">
        <header className="userContentHeader">
          <span><Bookmark size={19} aria-hidden="true" /><h1>收藏</h1></span>
          <ResultCount count={mediaResult?.totalAssets ?? novelResult?.totalBooks ?? 0} />
        </header>
        <nav className="messagesTabs favoriteTabs" aria-label="收藏类型">
          <Link className={!mediaKind ? "isActive" : ""} href="/favorites">小说</Link>
          <Link className={mediaKind === "video" ? "isActive" : ""} href="/favorites?type=videos">视频</Link>
          <Link className={mediaKind === "audio" ? "isActive" : ""} href="/favorites?type=audio">音频</Link>
        </nav>
        {novelResult?.books.length ? (
          <CatalogBookGrid
            books={novelResult.books}
            returnHref={`/favorites?page=${novelResult.page}`}
            ariaLabel="收藏小说"
            tagsByNovel={tagsByNovel}
          />
        ) : mediaKind === "video" && mediaResult?.assets.length ? (
          <div className="mediaAssetGrid is-video">
            {mediaResult.assets.map((asset, index) => (
              <MediaVideoCard
                asset={asset}
                thumbnail={thumbnailSettings}
                thumbnailUrl={directThumbnails
                  ? directMediaThumbnailUrl(asset, thumbnailSettings.singlePercent, publiclyAccessibleThumbnails)
                  : null}
                priority={index < 6}
                key={asset.id}
              />
            ))}
          </div>
        ) : mediaKind === "audio" && mediaResult?.assets.length ? (
          <div className="mediaResourceList">
            {mediaResult.assets.map((asset) => {
              const title = displayMediaTitle(asset.title, asset.fileName);
              return (
                <Link className="mediaResourceRow" href={`/media/${asset.id}`} key={asset.id}>
                  <span className="mediaAssetIcon is-audio" aria-hidden="true"><Disc3 size={21} /></span>
                  <span className="mediaCardCopy">
                    <strong title={title}>{title}</strong>
                    <small>{asset.artist || "未知作者"}</small>
                  </span>
                  <span className="mediaCardSize">{formatMediaDuration(asset.durationSeconds)}</span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="messageEmpty">
            {mediaKind === "video" ? "还没有收藏视频" : mediaKind === "audio" ? "还没有收藏音频" : "还没有收藏小说"}
          </div>
        )}
        {novelResult ? (
          <Pagination page={novelResult.page} totalPages={novelResult.totalPages} query="" basePath="/favorites" />
        ) : mediaResult ? (
          <Pagination
            page={mediaResult.page}
            totalPages={mediaResult.totalPages}
            query=""
            basePath="/favorites"
            extraParams={{ type: mediaKind === "audio" ? "audio" : "videos" }}
          />
        ) : null}
      </section>
    </UserWorkspace>
  );
}
