import { ArrowLeft, Clapperboard, Download, File, Headphones } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { MediaAudioPlayer, type AudioQueueTrack } from "@/components/MediaAudioPlayer";
import { MediaPlayer } from "@/components/MediaPlayer";
import { SiteHeader } from "@/components/SiteHeader";
import { recordAnalyticsEvent } from "@/lib/analytics";
import { getMediaAsset, isMediaKindEnabled, listMediaFolderAssets, type MediaKind } from "@/lib/media";
import { getCurrentUser } from "@/lib/user-auth";
import { recordMediaHistory } from "@/lib/users";

export const dynamic = "force-dynamic";

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

export default async function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || !isMediaKindEnabled(asset.kind)) notFound();

  const headerStore = await headers();
  recordAnalyticsEvent({
    headers: headerStore,
    userId: user.id,
    eventType: `${asset.kind}_view`,
    path: `/media/${asset.id}`,
    referrer: headerStore.get("referer"),
    mediaId: asset.id,
  });
  recordMediaHistory(user.id, asset);

  const Icon = KIND_ICONS[asset.kind];
  const title = displayTitle(asset.title, asset.fileName);
  const listFolder = asset.kind === "video" ? "" : asset.folder;
  const backLabel = asset.kind === "video" ? "返回视频列表" : `返回${asset.folder || `${KIND_LABELS[asset.kind]}根目录`}`;
  const folderAudio = asset.kind === "audio" ? listMediaFolderAssets("audio", asset.folder, 2_000) : [];
  if (asset.kind === "audio" && !folderAudio.some((item) => item.id === asset.id)) folderAudio.push(asset);
  const audioQueue: AudioQueueTrack[] = folderAudio
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN", { numeric: true }))
    .map((item) => ({
        id: item.id,
        title: displayTitle(item.title, item.fileName),
        artist: item.artist,
      }));

  return (
    <main className="appShell">
      <SiteHeader />
      <article className={`mediaDetail is-${asset.kind}`}>
        <Link className="mediaBackLink" href={listHref(asset.kind, listFolder)} aria-label={backLabel}>
          <ArrowLeft size={17} aria-hidden="true" />
          {backLabel}
        </Link>

        <header className="mediaDetailHeader">
          <span className={`mediaAssetIcon is-${asset.kind}`} aria-hidden="true"><Icon size={23} /></span>
          <div>
            <span>{KIND_LABELS[asset.kind]}{asset.kind !== "video" && asset.folder ? ` · ${asset.folder}` : ""}</span>
            <h1>{title}</h1>
            <p>{asset.kind === "audio" ? `${asset.artist || "未知作者"} · ${formatBytes(asset.sizeBytes)}` : formatBytes(asset.sizeBytes)}</p>
          </div>
        </header>

        {asset.kind === "video" ? (
          <div className="mediaVideoStage">
            <MediaPlayer id={asset.id} />
          </div>
        ) : asset.kind === "audio" ? (
          <MediaAudioPlayer initialId={asset.id} tracks={audioQueue} />
        ) : (
          <a className="mediaDownloadButton" href={`/media/${asset.id}/download`}>
            <Download size={18} aria-hidden="true" />
            下载文件
          </a>
        )}

        {asset.description ? <p className="mediaDescription">{asset.description}</p> : null}
      </article>
    </main>
  );
}
