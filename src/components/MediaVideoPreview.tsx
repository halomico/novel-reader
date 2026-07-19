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
  admin = false,
}: {
  id: number;
  mode?: "single" | "carousel";
  frameCount?: number;
  intervalSeconds?: number;
  singlePercent?: number;
  sourceVersion: number;
  admin?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [isCarouselActive, setIsCarouselActive] = useState(false);
  const frames = mode === "carousel" ? Math.max(2, frameCount) : 1;

  useEffect(() => {
    setFrame(0);
    setIsCarouselActive(false);
  }, [id, mode, frames, singlePercent, sourceVersion]);

  const version = `${mode === "carousel" ? `carousel-${frames}` : `single-${singlePercent}`}-${Math.floor(sourceVersion)}`;
  const src = `${admin ? "/admin/media" : "/media"}/${id}/thumbnail?frame=${frame}&v=${version}`;
  const failed = failedSrc === src;

  useEffect(() => {
    if (mode !== "carousel" || !isCarouselActive || failed) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFrame((current) => (current + 1) % frames);
    }, Math.max(1, intervalSeconds) * 1_000);
    return () => window.clearTimeout(timer);
  }, [failed, frames, intervalSeconds, isCarouselActive, mode]);

  useEffect(() => {
    if (!isCarouselActive && frame !== 0) {
      setFrame(0);
    }
  }, [frame, isCarouselActive]);

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
          key={src}
          src={src}
          alt=""
          decoding="async"
          height="360"
          loading="lazy"
          width="640"
          onError={() => setFailedSrc(src)}
        />
      ) : null}
    </span>
  );
}
