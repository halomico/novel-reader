"use client";

import { Clapperboard } from "lucide-react";
import { useState } from "react";

export function MediaVideoPreview({
  id,
  singlePercent = 33,
  sourceVersion,
  admin = false,
}: {
  id: number;
  singlePercent?: number;
  sourceVersion: number;
  admin?: boolean;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const version = `single-${singlePercent}-${Math.floor(sourceVersion)}`;
  const src = `${admin ? "/admin/media" : "/media"}/${id}/thumbnail?v=${version}`;
  const failed = failedSrc === src;

  return (
    <span className="mediaVideoPreviewImage">
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
