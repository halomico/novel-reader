"use client";

import { Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";

export function MediaVideoPreview({
  id,
  mode = "single",
  frameCount = 3,
  intervalSeconds = 3,
  singlePercent = 33,
}: {
  id: number;
  mode?: "single" | "carousel";
  frameCount?: number;
  intervalSeconds?: number;
  singlePercent?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const frames = mode === "carousel" ? Math.max(2, frameCount) : 1;

  useEffect(() => {
    setFailed(false);
    setReady(false);
    setFrame(0);
  }, [id, mode, frames, singlePercent]);

  useEffect(() => {
    if (mode !== "carousel" || failed || !ready) {
      return;
    }
    const timer = window.setTimeout(() => {
      setReady(false);
      setFrame((current) => (current + 1) % frames);
    }, Math.max(1, intervalSeconds) * 1_000);
    return () => window.clearTimeout(timer);
  }, [failed, frames, intervalSeconds, mode, ready]);

  if (failed) {
    return (
      <span className="mediaVideoFallback" aria-hidden="true">
        <Clapperboard size={30} />
      </span>
    );
  }

  const version = mode === "carousel" ? `carousel-${frames}` : `single-${singlePercent}`;
  return (
    <img
      src={`/media/${id}/thumbnail?frame=${frame}&v=${version}`}
      alt=""
      loading="lazy"
      onLoad={() => setReady(true)}
      onError={() => setFailed(true)}
    />
  );
}
