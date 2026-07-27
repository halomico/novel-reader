import { Eye, Play } from "lucide-react";
import Link from "next/link";
import { mediaCoverVersion } from "@/lib/media-cover-version";
import { formatMediaDuration } from "@/lib/media-format";
import type { MediaAsset } from "@/lib/media";
import { MediaVideoPreview } from "./MediaVideoPreview";

function displayTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase()) ? title.slice(0, -extension.length) : title;
}

function formatCompactCount(value: number): string {
  return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(Math.max(value, 0));
}

export function MediaVideoCard({
  asset,
  thumbnail,
  thumbnailUrl,
  priority = false,
}: {
  asset: MediaAsset;
  thumbnail: {
    singlePercent: number;
  };
  thumbnailUrl?: string | null;
  priority?: boolean;
}) {
  const title = displayTitle(asset.title, asset.fileName);
  return (
    <Link className="mediaVideoCard" href={`/media/${asset.id}`}>
      <span className="mediaVideoPreview">
        <MediaVideoPreview
          id={asset.id}
          singlePercent={thumbnail.singlePercent}
          sourceVersion={asset.mtimeMs}
          coverVersion={mediaCoverVersion(asset, thumbnail.singlePercent)}
          src={thumbnailUrl || undefined}
          priority={priority}
        />
        <span className="mediaVideoPlay" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
        <span className="mediaVideoViews"><Eye size={12} aria-hidden="true" />{formatCompactCount(asset.playCount)}</span>
        <span className="mediaVideoMeta">{formatMediaDuration(asset.durationSeconds)}</span>
      </span>
      <span className="mediaCardCopy">
        <strong title={title}>{title}</strong>
        <small title={asset.artist || "未标注作者"}>{asset.artist || "未标注作者"}</small>
      </span>
    </Link>
  );
}
