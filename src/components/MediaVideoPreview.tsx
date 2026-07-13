"use client";

import { Clapperboard } from "lucide-react";
import { useState } from "react";

export function MediaVideoPreview({ id }: { id: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="mediaVideoFallback" aria-hidden="true">
        <Clapperboard size={30} />
      </span>
    );
  }

  return <img src={`/media/${id}/thumbnail`} alt="" loading="lazy" onError={() => setFailed(true)} />;
}
