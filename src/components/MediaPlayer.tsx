"use client";

import { useRef } from "react";

export function MediaPlayer({ id, posterVersion, sourceVersion }: { id: number; posterVersion: string; sourceVersion: number }) {
  const countedRef = useRef(false);

  function recordPlay() {
    if (countedRef.current) {
      return;
    }
    countedRef.current = true;
    void fetch(`/media/${id}/play`, { method: "POST", keepalive: true }).catch(() => {
      countedRef.current = false;
    });
  }

  return (
    <video
      className="mediaVideoPlayer"
      controls
      playsInline
      poster={`/media/${id}/thumbnail?frame=0&v=${encodeURIComponent(posterVersion)}`}
      preload="none"
      onPlay={recordPlay}
    >
      <source src={`/media/${id}/stream?v=${Math.floor(sourceVersion)}`} />
      当前浏览器无法播放这个视频。
    </video>
  );
}
