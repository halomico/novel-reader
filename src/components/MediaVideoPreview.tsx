"use client";

import { Clapperboard } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000] as const;

function retrySource(src: string, attempt: number): string {
  if (attempt <= 0) return src;
  return `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;
}

export function MediaVideoPreview({
  id,
  singlePercent = 33,
  sourceVersion,
  coverVersion,
  src: suppliedSrc,
  admin = false,
  priority = false,
  eager = priority,
}: {
  id: number;
  singlePercent?: number;
  sourceVersion: number;
  coverVersion?: string;
  src?: string;
  admin?: boolean;
  priority?: boolean;
  eager?: boolean;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(priority || eager);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const version = coverVersion || `single-${singlePercent}-${Math.floor(sourceVersion)}`;
  const baseSrc = suppliedSrc || `${admin ? "/admin/media" : "/media"}/${id}/thumbnail?v=${encodeURIComponent(version)}`;
  const src = retrySource(baseSrc, attempt);

  useEffect(() => {
    setAttempt(0);
    setWaiting(false);
    setFailed(false);
  }, [baseSrc]);

  useEffect(() => {
    if (visible || !containerRef.current || typeof IntersectionObserver === "undefined") {
      if (typeof IntersectionObserver === "undefined") setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" },
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!waiting || !visible || failed) return;
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) {
      setFailed(true);
      setWaiting(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setAttempt((current) => current + 1);
      setWaiting(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [attempt, failed, visible, waiting]);

  return (
    <span className="mediaVideoPreviewImage" ref={containerRef}>
      <span className="mediaVideoFallback" aria-hidden="true">
        <Clapperboard size={30} />
      </span>
      {!failed && !waiting ? (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          fetchPriority={priority ? "high" : "auto"}
          height="360"
          loading={priority || eager ? "eager" : "lazy"}
          width="640"
          onError={() => {
            if (attempt >= RETRY_DELAYS_MS.length) {
              setFailed(true);
            } else {
              setWaiting(true);
            }
          }}
        />
      ) : null}
    </span>
  );
}
