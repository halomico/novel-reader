"use client";

import { useEffect } from "react";

function eventId(novelId: number): string {
  const nonce = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `event_novel_${novelId}_${nonce}`;
}

function recordNovelView(novelId: number): void {
  void fetch("/api/analytics/novel-view", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
    body: JSON.stringify({ novelId, eventId: eventId(novelId) }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}

export function NovelViewTracker({ novelId, targetId = "reader-content" }: { novelId: number; targetId?: string }) {
  useEffect(() => {
    let recorded = false;
    const target = document.getElementById(targetId);
    if (!target) return;
    let visible = false;
    let timer = 0;
    const cancel = () => { if (timer) window.clearTimeout(timer); timer = 0; };
    const schedule = () => {
      cancel();
      if (!visible || recorded || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (!visible || recorded || document.visibilityState !== "visible") return;
        recorded = true;
        recordNovelView(novelId);
      }, 1_500);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.3);
      if (visible) schedule(); else cancel();
    }, { threshold: [0, 0.3, 0.5] });
    const onVisibility = () => document.visibilityState === "visible" ? schedule() : cancel();
    observer.observe(target);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { cancel(); observer.disconnect(); document.removeEventListener("visibilitychange", onVisibility); };
  }, [novelId, targetId]);
  return null;
}
