import { Clapperboard, File, Headphones } from "lucide-react";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { MediaAudioPlayer, type AudioQueueTrack } from "@/components/MediaAudioPlayer";
import { MediaPlayer } from "@/components/MediaPlayer";
import { getAdminAccessState } from "@/lib/admin-access";
import { getAdminSession } from "@/lib/admin-auth";
import { getAudioDefaultPlaybackMode, getVideoThumbnailSettings } from "@/lib/config";
import { getMediaAsset, listMediaFolderAssets, type MediaKind } from "@/lib/media";
import { scheduleMediaPreparation } from "@/lib/media-maintenance";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<MediaKind, string> = { video: "视频", audio: "音频", file: "文件" };
const KIND_ICONS = { video: Clapperboard, audio: Headphones, file: File };

function displayTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase()) ? title.slice(0, -extension.length) : title;
}

export default async function AdminMediaPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const headerStore = await headers();
  const access = getAdminAccessState(headerStore);
  if (!access.allowed || !(await getAdminSession())) {
    notFound();
  }
  const asset = getMediaAsset(Number((await params).id));
  if (!asset || (asset.kind !== "video" && asset.kind !== "audio")) {
    notFound();
  }

  const Icon = KIND_ICONS[asset.kind];
  const title = displayTitle(asset.title, asset.fileName);
  const folderAudio = asset.kind === "audio" ? listMediaFolderAssets("audio", asset.folder, 2_000) : [];
  if (asset.kind === "audio" && !folderAudio.some((item) => item.id === asset.id)) {
    folderAudio.push(asset);
  }
  const audioQueue: AudioQueueTrack[] = folderAudio
    .sort((left, right) => left.title.localeCompare(right.title, "zh-CN", { numeric: true }))
    .map((item) => ({
      id: item.id,
      title: displayTitle(item.title, item.fileName),
      artist: item.artist,
      version: item.mtimeMs,
    }));
  const thumbnailSettings = getVideoThumbnailSettings();
  const posterVersion = `${asset.mtimeMs}-${thumbnailSettings.mode}-${thumbnailSettings.singlePercent}-${thumbnailSettings.carouselFrames}`;
  scheduleMediaPreparation([asset]);

  return (
    <main className="adminShell adminPreviewShell">
      <article className={`mediaDetail adminMediaPreview is-${asset.kind}`}>
        <Breadcrumbs
          className="adminBreadcrumbs"
          items={[
            { label: "首页", href: "/" },
            { label: "后台", href: "/admin" },
            { label: "资源管理", href: "/admin/media" },
            { label: title },
          ]}
        />

        <header className="mediaDetailHeader">
          <span className={`mediaAssetIcon is-${asset.kind}`} aria-hidden="true"><Icon size={23} /></span>
          <div>
            <span>{KIND_LABELS[asset.kind]}预览</span>
            <h1>{title}</h1>
            {asset.kind === "audio" ? <p>{asset.artist || "未知作者"}</p> : null}
          </div>
        </header>

        {asset.kind === "video" ? (
          <div className="mediaVideoStage">
            <MediaPlayer
              id={asset.id}
              posterVersion={posterVersion}
              sourceVersion={asset.mtimeMs}
              basePath={`/admin/media/${asset.id}`}
            />
          </div>
        ) : (
          <MediaAudioPlayer
            initialId={asset.id}
            tracks={audioQueue}
            basePathPrefix="/admin/media"
            defaultPlaybackMode={getAudioDefaultPlaybackMode()}
          />
        )}
      </article>
    </main>
  );
}
