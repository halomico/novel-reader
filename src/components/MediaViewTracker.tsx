"use client";

import { useEffect } from "react";

export function MediaViewTracker({ mediaId, targetId = "media-detail-primary" }: { mediaId: number; targetId?: string }) {
  useEffect(() => {
    if (!document.getElementById(targetId)) return;
    const nonce = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const id = `event_media_${mediaId}_${nonce}`;
    let sent = false;
    let timer = 0;
    const cancel = () => { if (timer) clearTimeout(timer); timer = 0; };
    const schedule = () => {
      cancel();
      if (sent || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        if (sent || document.visibilityState !== "visible") return;
        sent = true;
        void fetch("/api/analytics/media-view", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: JSON.stringify({ mediaId, eventId: id }),
          keepalive: true,
          credentials: "same-origin",
        }).catch(() => undefined);
      }, 1_500);
    };
    schedule();
    const onVisibility = () => document.visibilityState === "visible" ? schedule() : cancel();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancel(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [mediaId, targetId]);
  return null;
}
