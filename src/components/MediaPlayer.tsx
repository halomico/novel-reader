"use client";

import { useMemo, useRef } from "react";

export function MediaPlayer({
  id,
  posterVersion,
  posterUrl,
  sourceVersion,
  basePath,
}: {
  id: number;
  posterVersion: string;
  posterUrl?: string | null;
  sourceVersion: number;
  basePath?: string;
}) {
  const countedRef = useRef(false);
  const mediaBasePath = useMemo(() => basePath || `/media/${id}`, [basePath, id]);

  function recordPlay() {
    if (countedRef.current) {
      return;
    }
    countedRef.current = true;
    void fetch(`${mediaBasePath}/play`, { method: "POST", keepalive: true }).catch(() => {
      countedRef.current = false;
    });
  }

  return (
    <video
      className="mediaVideoPlayer"
      controls
      playsInline
      poster={posterUrl || `${mediaBasePath}/thumbnail?v=${encodeURIComponent(posterVersion)}`}
      preload="metadata"
      onPlay={recordPlay}
    >
      <source src={`${mediaBasePath}/stream?v=${Math.floor(sourceVersion)}`} />
      当前浏览器无法播放这个视频。
    </video>
  );
}
