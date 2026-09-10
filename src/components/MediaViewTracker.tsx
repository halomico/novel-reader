"use client";

import { useEffect } from "react";

export function MediaViewTracker({ mediaId, targetId = "media-detail-primary" }: { mediaId: number; targetId?: string }) {
  useEffect(() => {
    let sent = false;
    const target = document.getElementById(targetId);
    if (!target) return;
    const nonce = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const id = `event_media_${mediaId}_${nonce}`;
    let visible = false; let timer = 0;
    const cancel = () => { if (timer) clearTimeout(timer); timer = 0; };
    const schedule = () => {
      cancel();
      if (!visible || sent || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        if (!visible || sent || document.visibilityState !== "visible") return;
        sent = true;
        void fetch("/api/analytics/media-view", { method: "POST", headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" }, body: JSON.stringify({ mediaId, eventId: id }), keepalive: true, credentials: "same-origin" }).catch(() => undefined);
      }, 1_500);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= .3); visible ? schedule() : cancel(); }, { threshold: [0, .3] });
    const onVisibility = () => document.visibilityState === "visible" ? schedule() : cancel();
    observer.observe(target); document.addEventListener("visibilitychange", onVisibility);
    return () => { cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [mediaId, targetId]);
  return null;
}
