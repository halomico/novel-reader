import { Eye, Play } from "lucide-react";
import { ContextNavigationLink } from "./ContextNavigationLink";
import { mediaCoverVersion } from "@/lib/media-cover-version";
import { formatMediaDuration } from "@/lib/media-format";
import type { MediaAsset } from "@/lib/media";
import { formatCompactUpdateDate, formatLocalDateTime, parseAppDateTime, toDateTimeAttribute } from "@/lib/date-time";
import { type AppLocale, uiText } from "@/lib/locale";
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
  eager = priority,
  returnHref,
  locale,
}: {
  asset: MediaAsset;
  thumbnail: {
    singlePercent: number;
  };
  thumbnailUrl?: string | null;
  priority?: boolean;
  eager?: boolean;
  returnHref?: string;
  locale: AppLocale;
}) {
  const title = displayTitle(asset.title, asset.fileName);
  const watchHref = `/media/${asset.id}${returnHref ? `?from=${encodeURIComponent(returnHref)}` : ""}#watch`;
  const isNew = Boolean(asset.newUntil && Date.parse(asset.newUntil) > Date.now());
  const publishedDate = parseAppDateTime(asset.publishedAt);
  return (
    <article className="mediaVideoCard">
      <ContextNavigationLink className="mediaVideoPreview" contextReturnHref={returnHref} href={watchHref} prefetch={false} aria-label={`播放 ${title}`}>
        <MediaVideoPreview
          id={asset.id}
          singlePercent={thumbnail.singlePercent}
          sourceVersion={asset.mtimeMs}
          coverVersion={mediaCoverVersion(asset, thumbnail.singlePercent)}
          src={thumbnailUrl || undefined}
          priority={priority}
          eager={eager}
        />
        <span className="mediaVideoPlay" aria-hidden="true"><Play size={20} fill="currentColor" /></span>
        {isNew ? <span className="mediaVideoNewBadge">新</span> : null}
        <span className="mediaVideoMeta">{formatMediaDuration(asset.durationSeconds)}</span>
      </ContextNavigationLink>
      <span className="mediaCardCopy">
        <ContextNavigationLink className="mediaVideoTitleLink" contextReturnHref={returnHref} href={watchHref} prefetch={false} title={title}>{title}</ContextNavigationLink>
        <span className="mediaVideoByline">
          <span className="mediaVideoAuthor" title={asset.artist || uiText(locale, "未知作者")}>{asset.artist || uiText(locale, "未知作者")}</span>
          <span className="mediaVideoMetrics">
            <span className="mediaVideoViews"><Eye size={11} aria-hidden="true" />{formatCompactCount(asset.playCount)}</span>
            {publishedDate ? (
              <time
                className="mediaVideoPublishedAt"
                dateTime={toDateTimeAttribute(asset.publishedAt)}
                title={formatLocalDateTime(asset.publishedAt)}
              >
                {formatCompactUpdateDate(publishedDate.getTime())}
              </time>
            ) : null}
          </span>
        </span>
      </span>
    </article>
  );
}
