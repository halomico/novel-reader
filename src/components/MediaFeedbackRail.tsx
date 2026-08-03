import { MediaFavoriteButton } from "./MediaFavoriteButton";
import { MediaRecommendationButton } from "./MediaRecommendationButton";
import { ReportMediaButton } from "./ReportMediaButton";

export function MediaFeedbackRail({
  mediaId,
  title,
  initialFavorite,
  initialRecommended,
  canRecommend,
  canReport,
}: {
  mediaId: number;
  title: string;
  initialFavorite: boolean;
  initialRecommended: boolean;
  canRecommend: boolean;
  canReport: boolean;
}) {
  return (
    <aside className="mediaFeedbackRail" aria-label="视频反馈">
      {canRecommend ? <span><MediaRecommendationButton mediaId={mediaId} initialRecommended={initialRecommended} /></span> : null}
      <span><MediaFavoriteButton mediaId={mediaId} initialFavorite={initialFavorite} /></span>
      {canReport ? <span><ReportMediaButton mediaId={mediaId} title={title} kind="video" /></span> : null}
    </aside>
  );
}
