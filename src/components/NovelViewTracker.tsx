"use client";

import { useEffect, useRef } from "react";

function recordNovelView(novelId: number) {
  const body = JSON.stringify({ novelId });
  if (typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon(
      "/api/analytics/novel-view",
      new Blob([body], { type: "application/json" }),
    );
    if (sent) return;
  }
  void fetch("/api/analytics/novel-view", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function NovelViewTracker({ novelId }: { novelId: number }) {
  const recordedRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!recordedRef.current && document.visibilityState !== "hidden") {
        recordedRef.current = true;
        recordNovelView(novelId);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [novelId]);

  return null;
}
