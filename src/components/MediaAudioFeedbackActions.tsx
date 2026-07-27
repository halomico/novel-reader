"use client";

import { useEffect, useRef, useState } from "react";
import { MediaFavoriteButton } from "@/components/MediaFavoriteButton";
import { MediaRecommendationButton } from "@/components/MediaRecommendationButton";
import { ReportMediaButton } from "@/components/ReportMediaButton";

type FeedbackState = {
  mediaId: number;
  favorite: boolean;
  recommended: boolean;
};

export function MediaAudioFeedbackActions({
  mediaId,
  initialMediaId,
  initialFavorite,
  initialRecommended,
  canRecommend,
  canReport,
  title,
}: {
  mediaId: number;
  initialMediaId: number;
  initialFavorite: boolean;
  initialRecommended: boolean;
  canRecommend: boolean;
  canReport: boolean;
  title: string;
}) {
  const firstRenderRef = useRef(true);
  const [feedback, setFeedback] = useState<FeedbackState>({
    mediaId: initialMediaId,
    favorite: initialFavorite,
    recommended: initialRecommended,
  });

  useEffect(() => {
    if (firstRenderRef.current && mediaId === initialMediaId) {
      firstRenderRef.current = false;
      return;
    }
    firstRenderRef.current = false;
    const controller = new AbortController();
    setFeedback((current) => current.mediaId === mediaId ? current : {
      mediaId: 0,
      favorite: false,
      recommended: false,
    });
    void fetch(`/api/media/${mediaId}/feedback`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as {
          ok?: boolean;
          favorite?: boolean;
          recommended?: boolean;
        };
        if (!response.ok || !result.ok) return;
        setFeedback({
          mediaId,
          favorite: Boolean(result.favorite),
          recommended: Boolean(result.recommended),
        });
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.error("Failed to load audio feedback state", error);
        }
      });
    return () => controller.abort();
  }, [initialMediaId, mediaId]);

  const ready = feedback.mediaId === mediaId;
  return (
    <div className="readerFeedbackActions feedbackActionTrio mediaAudioActions" aria-label="音频操作" aria-busy={!ready}>
      {canRecommend && ready ? (
        <MediaRecommendationButton
          mediaId={mediaId}
          initialRecommended={feedback.recommended}
          key={`recommend-${mediaId}`}
        />
      ) : null}
      {ready ? (
        <MediaFavoriteButton
          mediaId={mediaId}
          initialFavorite={feedback.favorite}
          key={`favorite-${mediaId}`}
        />
      ) : null}
      {canReport ? <ReportMediaButton mediaId={mediaId} title={title} kind="audio" /> : null}
    </div>
  );
}
