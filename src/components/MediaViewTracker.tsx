"use client";

import { useEffect, useRef } from "react";

export function MediaViewTracker({ mediaId, targetId = "media-detail-primary" }: { mediaId: number; targetId?: string }) {
  const sent = useRef(false);
  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const key = `novel-reader:media-view:${mediaId}`;
    let id = "";
    try {
      id = sessionStorage.getItem(key) || `event_${crypto.randomUUID().replace(/-/g, "")}`;
      sessionStorage.setItem(key, id);
    } catch { id = `event_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
    let visible = false; let timer = 0;
    const cancel = () => { if (timer) clearTimeout(timer); timer = 0; };
    const schedule = () => {
      cancel();
      if (!visible || sent.current || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        if (!visible || sent.current || document.visibilityState !== "visible") return;
        sent.current = true;
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
