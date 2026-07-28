import { Clapperboard, Clock3, Download, Eye, File, Headphones, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { MediaAudioPlayer, type AudioQueueTrack } from "@/components/MediaAudioPlayer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MediaConnectionHint } from "@/components/MediaConnectionHint";
import { MediaFavoriteButton } from "@/components/MediaFavoriteButton";
import { MediaPlayer } from "@/components/MediaPlayer";
import { MediaRecommendationButton } from "@/components/MediaRecommendationButton";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { ReportMediaButton } from "@/components/ReportMediaButton";
import { SiteHeader } from "@/components/SiteHeader";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getAudioDefaultPlaybackMode, getRelatedVideoSettings, getVideoThumbnailSettings } from "@/lib/config";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { isMediaFavorite } from "@/lib/favorites";
import { mediaCoverVersion } from "@/lib/media-cover-version";
import {
  getMediaAsset,
  isFeedbackMediaKind,
  isMediaKindAccessible,
  isMediaKindPublic,
  listMediaFolderAssets,
  listRelatedVideoAssets,
  type MediaKind,
} from "@/lib/media";
import { formatMediaDuration } from "@/lib/media-format";
import { getMediaPublicUrlForAsset } from "@/lib/media-storage-config";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { getMediaRecommendationState } from "@/lib/recommendations";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { recordMediaHistory } from "@/lib/users";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath, type AppLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

const getAssetById = cache(getMediaAsset);

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
}

function displayTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase()) ? title.slice(0, -extension.length) : title;
}

function listHref(kind: MediaKind, folder: string): string {
  const params = new URLSearchParams({ kind });
  if (folder) params.set("folder", folder);
  return `/media?${params.toString()}`;
}

function formatCompactCount(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(locale === "zh-Hant" ? "zh-TW" : "zh-CN", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.max(value, 0));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const locale = await getRequestLocale();
  const asset = getAssetById(Number((await params).id));
  if (!asset) {
    return { title: uiText(locale, "资源不存在"), robots: NO_INDEX_ROBOTS };
  }
  const title = await localizeText(displayTitle(asset.title, asset.fileName), locale);
  const canonicalPath = `/media/${asset.id}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const isPublic = isMediaKindAccessible(asset.kind, false);
  const description = asset.description
    ? await localizeText(asset.description, locale)
    : `${uiText(locale, KIND_LABELS[asset.kind])}${uiText(locale, "资源")}：${title}`;
  return {
    title,
    description,
    alternates: { canonical, languages: languageAlternates(canonicalPath) },
    robots: isPublic ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title, description, url: canonical },
  };
}

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const asset = getAssetById(Number((await params).id));
  if (!asset || !isMediaKindAccessible(asset.kind, Boolean(user))) notFound();
  const mediaPublicOrigin = getMediaPublicUrlForAsset(asset.storageNodeId, asset.kind);

  const headerStore = await headers();
  const access = checkContentAccess(headerStore, {
    scope: asset.kind,
    authenticated: Boolean(user),
    admin: user?.role === "admin",
    rateLimit: false,
  });
  if (!access.allowed) notFound();
  after(() => {
    recordAnalyticsEvent({
      headers: headerStore,
      userId: user?.id ?? null,
      eventType: `${asset.kind}_view`,
      path: `/media/${asset.id}`,
      referrer: headerStore.get("referer"),
      mediaId: asset.id,
    });
    if (user) recordMediaHistory(user.id, asset);
  });

  const Icon = KIND_ICONS[asset.kind];
  const title = await localizeText(displayTitle(asset.title, asset.fileName), locale);
  const displayArtist = asset.artist ? await localizeText(asset.artist, locale) : "";
  const displayDescription = await localizeText(asset.description, locale);
  const displayFolder = await localizeText(asset.folder, locale);
  const listFolder = asset.kind === "video" ? "" : asset.folder;
  const folderAudio = asset.kind === "audio" ? listMediaFolderAssets("audio", asset.folder, 2_000) : [];
  if (asset.kind === "audio" && !folderAudio.some((item) => item.id === asset.id)) folderAudio.push(asset);
  const audioQueue: AudioQueueTrack[] = await Promise.all(folderAudio
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN", { numeric: true }))
    .map(async (item) => ({
        id: item.id,
        title: await localizeText(displayTitle(item.title, item.fileName), locale),
        artist: item.artist ? await localizeText(item.artist, locale) : item.artist,
        durationSeconds: item.durationSeconds,
        version: item.mtimeMs,
      })));
  const relatedSettings = getRelatedVideoSettings();
  const thumbnailSettings = getVideoThumbnailSettings();
  const posterVersion = mediaCoverVersion(asset, thumbnailSettings.singlePercent);
  const directThumbnails = asset.kind === "video" && !hasScopedContentAccessRules("video");
  const publiclyAccessibleThumbnails = directThumbnails && isMediaKindPublic("video");
  const posterUrl = directThumbnails
    ? directMediaThumbnailUrl(asset, thumbnailSettings.singlePercent, publiclyAccessibleThumbnails)
    : null;
  const relatedVideos = asset.kind === "video" ? listRelatedVideoAssets(asset.id, relatedSettings.count, relatedSettings.mode) : [];
  const displayRelatedVideos = await Promise.all(relatedVideos.map(async (item) => ({
    ...item,
    title: await localizeText(item.title, locale),
    description: await localizeText(item.description, locale),
    artist: item.artist ? await localizeText(item.artist, locale) : item.artist,
  })));
  const feedbackMedia = isFeedbackMediaKind(asset.kind);
  const favorite = user && feedbackMedia ? isMediaFavorite(user.id, asset.id) : false;
  const recommendation = user && feedbackMedia ? getMediaRecommendationState(user.id, asset.id) : null;
  const canRecommend = feedbackMedia && hasUserPermission(user, "novel_feedback");
  const canReport = Boolean(feedbackMedia && user?.role === "user" && hasUserPermission(user, "content_report"));

  return (
    <>
      <MediaConnectionHint origin={mediaPublicOrigin} />
      <main className="appShell">
      <SiteHeader currentUser={user} />
      <article className={`mediaDetail is-${asset.kind}`}>
        <Breadcrumbs
          items={[
            { label: uiText(locale, "首页"), href: "/" },
            {
              label: uiText(locale, KIND_LABELS[asset.kind]),
              href: asset.kind === "audio" ? undefined : listHref(asset.kind, listFolder),
            },
            ...(asset.kind === "audio" ? [] : [{ label: title }]),
          ]}
        />

        {asset.kind === "file" ? (
          <header className="mediaDetailHeader">
            <span className={`mediaAssetIcon is-${asset.kind}`} aria-hidden="true"><Icon size={23} /></span>
            <div>
              <span>{uiText(locale, KIND_LABELS[asset.kind])}{displayFolder ? ` · ${displayFolder}` : ""}</span>
              <h1>{title}</h1>
              <p>{formatBytes(asset.sizeBytes)}</p>
            </div>
          </header>
        ) : null}

        {asset.kind === "video" ? (
          <>
            <header className="mediaVideoHeading">
              <h1>{title}</h1>
              <div className="mediaVideoStats" aria-label={uiText(locale, "视频信息")}>
                <span><Eye size={15} aria-hidden="true" />{formatCompactCount(asset.playCount, locale)}</span>
                <span><Clock3 size={15} aria-hidden="true" />{formatMediaDuration(asset.durationSeconds)}</span>
              </div>
            </header>
            <div className="mediaVideoStage">
              <MediaPlayer
                id={asset.id}
                posterVersion={posterVersion}
                posterUrl={posterUrl}
                sourceVersion={asset.mtimeMs}
              />
            </div>
            <section className="mediaVideoInfo" aria-label={uiText(locale, "作者与简介")}>
              <div className="mediaVideoInfoBar">
                <div className="mediaVideoAuthor">
                  <span aria-hidden="true"><UserRound size={20} /></span>
                  <div>
                    <strong>{displayArtist || uiText(locale, "未标注作者")}</strong>
                    <small>{uiText(locale, "作者")}</small>
                  </div>
                </div>
                {user ? (
                  <div className="readerFeedbackActions feedbackActionTrio mediaVideoActions" aria-label={uiText(locale, "视频操作")}>
                    {canRecommend && recommendation ? (
                      <MediaRecommendationButton
                        mediaId={asset.id}
                        initialRecommended={recommendation.recommended}
                      />
                    ) : null}
                    <MediaFavoriteButton mediaId={asset.id} initialFavorite={favorite} />
                    {canReport ? <ReportMediaButton mediaId={asset.id} title={title} kind="video" /> : null}
                  </div>
                ) : null}
              </div>
              {displayDescription ? <p className="mediaDescription">{displayDescription}</p> : null}
            </section>
          </>
        ) : asset.kind === "audio" ? (
          <MediaAudioPlayer
            initialId={asset.id}
            tracks={audioQueue}
            defaultPlaybackMode={getAudioDefaultPlaybackMode()}
            locale={locale}
            feedback={user ? {
              initialFavorite: favorite,
              initialRecommended: recommendation?.recommended ?? false,
              canRecommend,
              canReport,
            } : undefined}
          />
        ) : (
          <a className="mediaDownloadButton" href={`/media/${asset.id}/download`}>
            <Download size={18} aria-hidden="true" />
            {uiText(locale, "下载文件")}
          </a>
        )}

        {asset.kind !== "video" && displayDescription ? <p className="mediaDescription">{displayDescription}</p> : null}
        {displayRelatedVideos.length ? (
          <section className="mediaRelatedVideos">
            <h2>{uiText(locale, "更多视频")}</h2>
            <div className="mediaAssetGrid is-video">
              {displayRelatedVideos.map((item) => (
                <MediaVideoCard
                  asset={item}
                  thumbnail={thumbnailSettings}
                  thumbnailUrl={directThumbnails
                    ? directMediaThumbnailUrl(item, thumbnailSettings.singlePercent, publiclyAccessibleThumbnails)
                    : null}
                  key={item.id}
                />
              ))}
            </div>
          </section>
        ) : null}
      </article>
      </main>
    </>
  );
}
