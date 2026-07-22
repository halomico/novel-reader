import { Clapperboard, Download, File, Headphones } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { cache } from "react";
import { MediaAudioPlayer, type AudioQueueTrack } from "@/components/MediaAudioPlayer";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MediaPlayer } from "@/components/MediaPlayer";
import { MediaVideoCard } from "@/components/MediaVideoCard";
import { SiteHeader } from "@/components/SiteHeader";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getAudioDefaultPlaybackMode, getRelatedVideoSettings, getVideoThumbnailSettings } from "@/lib/config";
import { getMediaAsset, isMediaKindAccessible, listMediaFolderAssets, listRelatedVideoAssets, type MediaKind } from "@/lib/media";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";
import { getCurrentUser } from "@/lib/user-auth";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { recordMediaHistory } from "@/lib/users";

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

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const asset = getAssetById(Number((await params).id));
  if (!asset) {
    return { title: "资源不存在", robots: NO_INDEX_ROBOTS };
  }
  const title = displayTitle(asset.title, asset.fileName);
  const canonical = `/media/${asset.id}`;
  const isPublic = isMediaKindAccessible(asset.kind, false);
  const description = asset.description || `${KIND_LABELS[asset.kind]}资源：${title}`;
  return {
    title,
    description,
    alternates: { canonical },
    robots: isPublic ? { index: true, follow: true } : NO_INDEX_ROBOTS,
    openGraph: { title, description, url: canonical },
  };
}

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  const asset = getAssetById(Number((await params).id));
  if (!asset || !isMediaKindAccessible(asset.kind, Boolean(user))) notFound();

  const headerStore = await headers();
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
  const title = displayTitle(asset.title, asset.fileName);
  const listFolder = asset.kind === "video" ? "" : asset.folder;
  const folderAudio = asset.kind === "audio" ? listMediaFolderAssets("audio", asset.folder, 2_000) : [];
  if (asset.kind === "audio" && !folderAudio.some((item) => item.id === asset.id)) folderAudio.push(asset);
  const audioQueue: AudioQueueTrack[] = folderAudio
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN", { numeric: true }))
    .map((item) => ({
        id: item.id,
        title: displayTitle(item.title, item.fileName),
        artist: item.artist,
        version: item.mtimeMs,
      }));
  const relatedSettings = getRelatedVideoSettings();
  const thumbnailSettings = getVideoThumbnailSettings();
  const posterVersion = `${asset.mtimeMs}-${thumbnailSettings.mode}-${thumbnailSettings.singlePercent}-${thumbnailSettings.carouselFrames}`;
  const relatedVideos = asset.kind === "video" ? listRelatedVideoAssets(asset.id, relatedSettings.count, relatedSettings.mode) : [];
  scheduleMediaPreparation([asset, ...relatedVideos]);

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <article className={`mediaDetail is-${asset.kind}`}>
        <Breadcrumbs
          items={[
            { label: "首页", href: "/" },
            { label: KIND_LABELS[asset.kind], href: listHref(asset.kind, listFolder) },
            { label: title },
          ]}
        />

        <header className="mediaDetailHeader">
          <span className={`mediaAssetIcon is-${asset.kind}`} aria-hidden="true"><Icon size={23} /></span>
          <div>
            <span>{KIND_LABELS[asset.kind]}{asset.kind !== "video" && asset.folder ? ` · ${asset.folder}` : ""}</span>
            <h1>{title}</h1>
            {asset.kind === "audio" ? <p>{asset.artist || "未知作者"}</p> : asset.kind === "file" ? <p>{formatBytes(asset.sizeBytes)}</p> : null}
          </div>
        </header>

        {asset.kind === "video" ? (
          <div className="mediaVideoStage">
            <MediaPlayer id={asset.id} posterVersion={posterVersion} sourceVersion={asset.mtimeMs} />
          </div>
        ) : asset.kind === "audio" ? (
          <MediaAudioPlayer initialId={asset.id} tracks={audioQueue} defaultPlaybackMode={getAudioDefaultPlaybackMode()} />
        ) : (
          <a className="mediaDownloadButton" href={`/media/${asset.id}/download`}>
            <Download size={18} aria-hidden="true" />
            下载文件
          </a>
        )}

        {asset.description ? <p className="mediaDescription">{asset.description}</p> : null}
        {relatedVideos.length ? (
          <section className="mediaRelatedVideos">
            <h2>更多视频</h2>
            <div className="mediaAssetGrid is-video">
              {relatedVideos.map((item) => <MediaVideoCard asset={item} thumbnail={thumbnailSettings} key={item.id} />)}
            </div>
          </section>
        ) : null}
      </article>
    </main>
  );
}
