"use client";

import { Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";

export function MediaVideoPreview({
  id,
  mode = "single",
  frameCount = 3,
  intervalSeconds = 3,
  singlePercent = 33,
  sourceVersion,
}: {
  id: number;
  mode?: "single" | "carousel";
  frameCount?: number;
  intervalSeconds?: number;
  singlePercent?: number;
  sourceVersion: number;
}) {
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [frame, setFrame] = useState(0);
  const [isCarouselActive, setIsCarouselActive] = useState(false);
  const frames = mode === "carousel" ? Math.max(2, frameCount) : 1;

  useEffect(() => {
    setFailed(false);
    setReady(false);
    setFrame(0);
    setIsCarouselActive(false);
  }, [id, mode, frames, singlePercent, sourceVersion]);

  useEffect(() => {
    if (mode !== "carousel" || !isCarouselActive || failed || !ready) {
      return;
    }
    const timer = window.setTimeout(() => {
      setReady(false);
      setFrame((current) => (current + 1) % frames);
    }, Math.max(1, intervalSeconds) * 1_000);
    return () => window.clearTimeout(timer);
  }, [failed, frames, intervalSeconds, isCarouselActive, mode, ready]);

  useEffect(() => {
    if (!isCarouselActive && frame !== 0) {
      setReady(false);
      setFrame(0);
    }
  }, [frame, isCarouselActive]);

  const version = `${mode === "carousel" ? `carousel-${frames}` : `single-${singlePercent}`}-${Math.floor(sourceVersion)}`;
  return (
    <span
      className="mediaVideoPreviewImage"
      onPointerEnter={() => setIsCarouselActive(true)}
      onPointerLeave={() => setIsCarouselActive(false)}
    >
      <span className="mediaVideoFallback" aria-hidden="true">
        <Clapperboard size={30} />
      </span>
      {!failed ? (
        <img
          className={ready ? "isReady" : undefined}
          src={`/media/${id}/thumbnail?frame=${frame}&v=${version}`}
          alt=""
          decoding="async"
          height="360"
          loading="lazy"
          width="640"
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </span>
  );
}
