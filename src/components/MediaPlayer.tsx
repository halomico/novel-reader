"use client";

import { useRef } from "react";

export function MediaPlayer({ id }: { id: number }) {
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
    <video className="mediaVideoPlayer" controls preload="metadata" playsInline onPlay={recordPlay}>
      <source src={`/media/${id}/stream`} />
      当前浏览器无法播放这个视频。
    </video>
  );
}
