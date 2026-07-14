import { Play } from "lucide-react";
import Link from "next/link";
import { formatMediaDuration } from "@/lib/media-metadata";
import type { MediaAsset } from "@/lib/media";
import { MediaVideoPreview } from "./MediaVideoPreview";

function displayTitle(title: string, fileName: string): string {
  const extension = /\.[^.]+$/.exec(fileName)?.[0] || "";
  return extension && title.toLowerCase().endsWith(extension.toLowerCase()) ? title.slice(0, -extension.length) : title;
}

export function MediaVideoCard({
  asset,
  thumbnail,
}: {
  asset: MediaAsset;
  thumbnail: {
    mode: "single" | "carousel";
    singlePercent: number;
    carouselFrames: number;
    carouselIntervalSeconds: number;
  };
}) {
  const title = displayTitle(asset.title, asset.fileName);
  return (
    <Link className="mediaVideoCard" href={`/media/${asset.id}`}>
      <span className="mediaVideoPreview">
        <MediaVideoPreview
          id={asset.id}
          mode={thumbnail.mode}
          singlePercent={thumbnail.singlePercent}
          frameCount={thumbnail.carouselFrames}
          intervalSeconds={thumbnail.carouselIntervalSeconds}
        />
        <span className="mediaVideoPlay" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
        <span className="mediaVideoMeta">{formatMediaDuration(asset.durationSeconds)}</span>
      </span>
      <span className="mediaCardCopy">
        <strong title={title}>{title}</strong>
        {asset.description ? <small title={asset.description}>{asset.description}</small> : null}
      </span>
    </Link>
  );
}
