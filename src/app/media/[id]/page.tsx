import { Clapperboard, Clock3, Download, Eye, File, Headphones } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { MediaAudioPlayer, type AudioQueueTrack } from "@/components/MediaAudioPlayer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContentAccessGate } from "@/components/ContentAccessGate";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import Link from "@/components/LocalizedLink";
import { MediaConnectionHint } from "@/components/MediaConnectionHint";
import { MediaFeedbackRail } from "@/components/MediaFeedbackRail";
import { MediaPlayer } from "@/components/MediaPlayer";
import { MediaTextDocument } from "@/components/MediaTextDocument";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { SiteHeader } from "@/components/SiteHeader";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getAudioDefaultPlaybackMode, getRelatedVideoSettings, getVideoThumbnailSettings } from "@/lib/config";
import { checkContentAccess, hasScopedContentAccessRules } from "@/lib/content-access";
import { isMediaFavorite } from "@/lib/favorites";
import { getMediaGroveState } from "@/lib/grove";
import { getVideoDownloadAccess, getVideoPlaybackAccess } from "@/lib/media-access";
import { mediaCoverVersion } from "@/lib/media-cover-version";
import {
  getMediaAsset,
  isFeedbackMediaKind,
  isMediaKindAccessible,
  isMediaKindConsumable,
  isMediaKindEntryVisible,
  isMediaKindPublic,
  listMediaFolderAssets,
  listRelatedVideoAssets,
  listVideoTagsForAsset,
  type MediaKind,
} from "@/lib/media";
import { formatMediaDuration } from "@/lib/media-format";
import { getMediaPublicUrlForAsset } from "@/lib/media-storage-config";
import { directMediaThumbnailUrl } from "@/lib/media-thumbnail-url";
import { isMediaTextPreviewSupported } from "@/lib/media-text-preview";
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

function safeVideoReturnHref(value: string | undefined): string {
  const fallback = listHref("video", "");
  if (!value || !value.startsWith("/media?") || value.startsWith("//") || /[\\\r\n#]/u.test(value)) {
    return fallback;
  }
  try {
    return new URL(value, "http://local").searchParams.get("kind") === "video" ? value : fallback;
  } catch {
    return fallback;
  }
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
  if (!isMediaKindPublic(asset.kind)) {
    return { title: uiText(locale, KIND_LABELS[asset.kind]), robots: NO_INDEX_ROBOTS };
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

export default async function MediaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const [routeParams, detailQuery] = await Promise.all([params, searchParams]);
  const asset = getAssetById(Number(routeParams.id));
  if (!asset) notFound();
  if (!isMediaKindAccessible(asset.kind, Boolean(user))) {
    if (!user && isMediaKindEntryVisible(asset.kind, false)) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, KIND_LABELS[asset.kind])} returnTo={`/media/${asset.id}`} />;
    }
    notFound();
  }
  const contentAccessible = isMediaKindConsumable(asset.kind, Boolean(user));
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
  const displayDescription = await localizeText(asset.description, locale);
  const displayFolder = await localizeText(asset.folder, locale);
  const displayArtist = asset.artist ? await localizeText(asset.artist, locale) : "";
  const listFolder = asset.kind === "video" ? "" : asset.folder;
  const folderAudio = asset.kind === "audio" && contentAccessible ? listMediaFolderAssets("audio", asset.folder, 2_000) : [];
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
  })));
  const videoTags = asset.kind === "video" ? listVideoTagsForAsset(asset.id).filter((tag) => tag.visible) : [];
  const displayVideoTags = await Promise.all(videoTags.map(async (tag) => ({
    ...tag,
    name: await localizeText(tag.name, locale),
  })));
  const feedbackMedia = isFeedbackMediaKind(asset.kind);
  const favorite = user && feedbackMedia ? isMediaFavorite(user.id, asset.id) : false;
  const grove = user && feedbackMedia ? getMediaGroveState(user.id, asset.id) : null;
  const recommendation = user && feedbackMedia ? getMediaRecommendationState(user.id, asset.id) : null;
  const canRecommend = feedbackMedia && hasUserPermission(user, "novel_feedback");
  const canReport = Boolean(feedbackMedia && user?.role === "user" && hasUserPermission(user, "content_report"));
  const videoDownloadAccess = asset.kind === "video" ? getVideoDownloadAccess(asset, user) : null;
  const showVideoDownload = asset.kind === "video" && Boolean(user && hasUserPermission(user, "video_download"));
  const textPreviewSupported = isMediaTextPreviewSupported(asset);
  const videoPlaybackAccess = asset.kind === "video" ? getVideoPlaybackAccess(asset, user) : null;
  const videoReturnHref = safeVideoReturnHref(detailQuery.from);

  return (
    <>
      <MediaConnectionHint origin={mediaPublicOrigin} />
      <main className="appShell">
      <SiteHeader
        currentUser={user}
        mobileBackHref={asset.kind === "video" ? videoReturnHref : undefined}
        mobileBackLabel={asset.kind === "video" ? uiText(locale, "返回视频列表") : undefined}
        mediaSearchKind={asset.kind === "video" ? "video" : undefined}
      />
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

        {asset.kind === "file" || (asset.kind === "audio" && !contentAccessible) ? (
          <header className="mediaDetailHeader">
            <span className={`mediaAssetIcon is-${asset.kind}`} aria-hidden="true"><Icon size={23} /></span>
            <div>
              <span>{uiText(locale, KIND_LABELS[asset.kind])}{displayFolder ? ` · ${displayFolder}` : ""}</span>
              <h1>{title}</h1>
              <p>{asset.kind === "audio"
                ? [displayArtist, formatMediaDuration(asset.durationSeconds)].filter(Boolean).join(" · ")
                : formatBytes(asset.sizeBytes)}</p>
            </div>
          </header>
        ) : null}

        {asset.kind === "video" ? (
          <section className="mediaVideoWatch" id="watch">
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
                authenticated={Boolean(user)}
                initialPlaybackAllowed={Boolean(videoPlaybackAccess?.allowed)}
                initialAccessExpiresAt={videoPlaybackAccess?.expiresAt || null}
                contentAccessible={contentAccessible}
              />
            </div>
            <section className="mediaVideoInfo" aria-label={uiText(locale, "标签与简介")}>
              {displayVideoTags.length || user ? <div className="mediaVideoInfoBar">
                {displayVideoTags.length ? (
                  <nav className="mediaVideoTags" aria-label={uiText(locale, "视频标签")}>
                    {displayVideoTags.map((tag) => (
                      <Link className="contentTag contentTagLink" href={`/media?${new URLSearchParams({ kind: "video", tag: tag.slug }).toString()}`} key={tag.id}>
                        #{tag.name}
                      </Link>
                    ))}
                  </nav>
                ) : <span />}
                {user ? (
                  <MediaFeedbackRail
                    mediaId={asset.id}
                    title={title}
                    initialFavorite={favorite}
                    initialRecommended={Boolean(recommendation?.recommended)}
                    initialInGrove={Boolean(grove?.planted)}
                    canRecommend={canRecommend}
                    canReport={canReport}
                    download={showVideoDownload && user ? {
                      price: asset.downloadSodaPrice,
                      sodaBalance: user.sodaBalance,
                      available: Boolean(videoDownloadAccess?.allowed),
                      accessExpiresAt: videoDownloadAccess?.expiresAt ?? null,
                      admin: user.role === "admin",
                      sizeLabel: formatBytes(asset.sizeBytes),
                    } : undefined}
                  />
                ) : null}
              </div> : null}
              {displayDescription ? <p className="mediaDescription">{displayDescription}</p> : null}
            </section>
          </section>
        ) : !contentAccessible ? (
          <ContentAccessGate returnTo={`/media/${asset.id}`} />
        ) : asset.kind === "audio" ? (
          <MediaAudioPlayer
            initialId={asset.id}
            tracks={audioQueue}
            defaultPlaybackMode={getAudioDefaultPlaybackMode()}
            locale={locale}
            feedback={user ? {
              initialFavorite: favorite,
              initialRecommended: recommendation?.recommended ?? false,
              initialInGrove: grove?.planted ?? false,
              canRecommend,
              canReport,
            } : undefined}
          />
        ) : (
          <section className="mediaFileContent">
            {textPreviewSupported ? <MediaTextDocument mediaId={asset.id} /> : null}
            <a className="mediaDownloadButton" href={`/media/${asset.id}/download`}>
              <Download size={18} aria-hidden="true" />
              {uiText(locale, "下载文件")}
            </a>
          </section>
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
                  returnHref={videoReturnHref}
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
