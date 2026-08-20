"use client";

import { useEffect, useRef, useState } from "react";
import { GroveButton } from "@/components/GroveButton";
import { MediaFavoriteButton } from "@/components/MediaFavoriteButton";
import { ReportMediaButton } from "@/components/ReportMediaButton";

type FeedbackState = {
  mediaId: number;
  favorite: boolean;
  inGrove: boolean;
  recommended: boolean;
};

export function MediaAudioFeedbackActions({
  mediaId,
  initialMediaId,
  initialFavorite,
  initialRecommended,
  initialInGrove,
  canReport,
  title,
}: {
  mediaId: number;
  initialMediaId: number;
  initialFavorite: boolean;
  initialRecommended: boolean;
  initialInGrove: boolean;
  canRecommend: boolean;
  canReport: boolean;
  title: string;
}) {
  const firstRenderRef = useRef(true);
  const [feedback, setFeedback] = useState<FeedbackState>({
    mediaId: initialMediaId,
    favorite: initialFavorite,
    inGrove: initialInGrove,
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
      inGrove: false,
      recommended: false,
    });
    void fetch(`/api/media/${mediaId}/feedback`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = await response.json() as {
          ok?: boolean;
          favorite?: boolean;
          inGrove?: boolean;
          recommended?: boolean;
        };
        if (!response.ok || !result.ok) return;
        setFeedback({
          mediaId,
          favorite: Boolean(result.favorite),
          inGrove: Boolean(result.inGrove),
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
      {ready ? (
        <GroveButton
          contentType="media"
          contentId={mediaId}
          initialPlanted={feedback.inGrove}
          key={`grove-${mediaId}`}
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
