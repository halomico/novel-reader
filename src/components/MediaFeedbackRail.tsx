import { GroveButton } from "./GroveButton";
import { MediaFavoriteButton } from "./MediaFavoriteButton";
import { MediaDownloadButton } from "./MediaDownloadButton";
import { ReportMediaButton } from "./ReportMediaButton";

export function MediaFeedbackRail({
  mediaId,
  title,
  initialFavorite,
  initialInGrove,
  canReport,
  download,
}: {
  mediaId: number;
  title: string;
  initialFavorite: boolean;
  initialRecommended: boolean;
  initialInGrove: boolean;
  canRecommend: boolean;
  canReport: boolean;
  download?: {
    price: number;
    sodaBalance: number;
    available: boolean;
    accessExpiresAt: number | null;
    admin: boolean;
    sizeLabel: string;
  };
}) {
  return (
    <aside className="mediaFeedbackRail" aria-label="视频操作">
      <span><GroveButton contentType="media" contentId={mediaId} initialPlanted={initialInGrove} /></span>
      <span><MediaFavoriteButton mediaId={mediaId} initialFavorite={initialFavorite} /></span>
      {canReport ? <span><ReportMediaButton mediaId={mediaId} title={title} kind="video" /></span> : null}
      {download ? (
        <span>
          <MediaDownloadButton
            mediaId={mediaId}
            title={title}
            sizeLabel={download.sizeLabel}
            price={download.price}
            initialSodaBalance={download.sodaBalance}
            initiallyAvailable={download.available}
            initialAccessExpiresAt={download.accessExpiresAt}
            admin={download.admin}
          />
        </span>
      ) : null}
    </aside>
  );
}
