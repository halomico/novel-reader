"use client";

import { useEffect, useRef } from "react";

function eventId(novelId: number): string {
  const key = `novel-reader:novel-view:${novelId}`;
  try {
    const current = sessionStorage.getItem(key);
    if (current) return current;
    const value = `event_${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    sessionStorage.setItem(key, value);
    return value;
  } catch {
    return `event_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
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
  const recordedRef = useRef(false);
  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    let visible = false;
    let timer = 0;
    const cancel = () => { if (timer) window.clearTimeout(timer); timer = 0; };
    const schedule = () => {
      cancel();
      if (!visible || recordedRef.current || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (!visible || recordedRef.current || document.visibilityState !== "visible") return;
        recordedRef.current = true;
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
