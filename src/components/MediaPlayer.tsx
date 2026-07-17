"use client";

import { useMemo, useRef } from "react";

export function MediaPlayer({
  id,
  posterVersion,
  sourceVersion,
  basePath,
}: {
  id: number;
  posterVersion: string;
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
      poster={`${mediaBasePath}/thumbnail?frame=0&v=${encodeURIComponent(posterVersion)}`}
      preload="none"
      onPlay={recordPlay}
    >
      <source src={`${mediaBasePath}/stream?v=${Math.floor(sourceVersion)}`} />
      当前浏览器无法播放这个视频。
    </video>
  );
}
