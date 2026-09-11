"use client";

import { useEffect, useRef } from "react";
import { READER_LAYOUT_CHANGE_EVENT } from "@/lib/reader-layout";

const STORAGE_PREFIX = "novel-reader:original-reading-position:";
const SAVE_DELAY_MS = 900;
const ENGAGEMENT_DELAY_MS = 1_500;

type StoredPosition = { ratio?: number; top?: number };

function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(slug)}`;
}

function eventId(articleId: number, action: "detail_view" | "read_open"): string {
  const nonce = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "")
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `event_original_${articleId}_${action}_${nonce}`;
}

function readPosition(slug: string): StoredPosition | null {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0) return { top: parsed };
      if (!parsed || typeof parsed !== "object") return null;
      const position = parsed as { ratio?: unknown; top?: unknown };
      const ratio = Number(position.ratio);
      const top = Number(position.top);
      if (Number.isFinite(ratio) && ratio >= 0) return { ratio: Math.min(ratio, 1) };
      if (Number.isFinite(top) && top >= 0) return { top };
    } catch {
      const top = Number(raw);
      if (Number.isFinite(top) && top >= 0) return { top };
    }
  } catch {
    // The server copy remains available when local storage is blocked.
  }
  return null;
}

function articleMetrics() {
  const body = document.getElementById("original-body");
  if (!body) return null;
  const top = body.getBoundingClientRect().top + window.scrollY;
  const travel = Math.max(body.offsetHeight - window.innerHeight, 1);
  return { top, travel };
}

function currentRatio(): number {
  const metrics = articleMetrics();
  if (!metrics) return 0;
  return Math.min(Math.max((window.scrollY - metrics.top) / metrics.travel, 0), 1);
}

function restorePosition(position: StoredPosition): void {
  const ratio = Number(position.ratio);
  const metrics = articleMetrics();
  if (!metrics) return;
  const top = Number.isFinite(ratio)
    ? metrics.top + metrics.travel * Math.min(Math.max(ratio, 0), 1)
    : Math.max(Number(position.top) || metrics.top, metrics.top);
  window.scrollTo({ top, left: 0, behavior: "auto" });
}

function writePosition(slug: string, ratio: number): void {
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify({ ratio }));
  } catch {
    // Ignore storage policy errors; the debounced server save still runs.
  }
}

function saveProgress(articleId: number, ratio: number, keepalive = false): void {
  void fetch("/api/account/original-reading-progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
    body: JSON.stringify({ articleId, scrollRatio: ratio }),
    keepalive,
  }).catch(() => undefined);
}

function sendEngagement(articleId: number, action: "detail_view" | "read_open"): void {
  void fetch(`/api/original/${articleId}/engagement`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
    body: JSON.stringify({ eventId: eventId(articleId, action), action }),
    keepalive: true,
    credentials: "same-origin",
  }).catch(() => undefined);
}

function useVisibleEngagement(articleId: number, targetId: string) {
  useEffect(() => {
    if (!document.getElementById(targetId)) return;
    let sent = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    }
    function schedule() {
      cancel();
      if (document.visibilityState !== "visible" || sent) return;
      timer = setTimeout(() => {
        timer = null;
        if (document.visibilityState !== "visible" || sent) return;
        sent = true;
        sendEngagement(articleId, "detail_view");
      }, ENGAGEMENT_DELAY_MS);
    }
    schedule();
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") schedule();
      else cancel();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancel();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [articleId, targetId]);
}

export function OriginalArticleTracker({
  articleId,
  slug,
  engagementTargetId,
  readingProgressEnabled,
  resume,
  initialRatio = 0,
}: {
  articleId: number;
  slug: string;
  engagementTargetId: string;
  readingProgressEnabled: boolean;
  resume: boolean;
  initialRatio?: number;
}) {
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSentRatioRef = useRef(initialRatio);
  const readOpenSentRef = useRef(false);
  const prevArticleIdRef = useRef(articleId);

  if (prevArticleIdRef.current !== articleId) {
    prevArticleIdRef.current = articleId;
    lastSentRatioRef.current = initialRatio;
    readOpenSentRef.current = false;
  }

  useVisibleEngagement(articleId, engagementTargetId);

  useEffect(() => {
    if (!readingProgressEnabled) {
      try { window.localStorage.removeItem(storageKey(slug)); } catch { /* ignore */ }
      return;
    }
    const local = readPosition(slug);
    const saved = initialRatio > 0 ? { ratio: initialRatio } : local;
    let restoreTimer = 0;
    if (resume && saved) {
      let attempts = 0;
      const stripResume = () => {
        const url = new URL(window.location.href);
        if (url.searchParams.get("resume") !== "1") return;
        url.searchParams.delete("resume");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      };
      const restore = () => {
        attempts += 1;
        restorePosition(saved);
        if (attempts >= 8) {
          stripResume();
          return;
        }
        restoreTimer = window.setTimeout(restore, attempts < 3 ? 50 : 120);
      };
      restore();
      void document.fonts?.ready.then(() => {
        if (attempts < 8) restore();
      });
    } else if (resume) {
      const url = new URL(window.location.href);
      url.searchParams.delete("resume");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    function flush(send = true, keepalive = false) {
      if (frameRef.current !== null) { window.cancelAnimationFrame(frameRef.current); frameRef.current = null; }
      if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
      const ratio = currentRatio();
      writePosition(slug, ratio);
      if (!readOpenSentRef.current && ratio > 0.01 && document.visibilityState === "visible") {
        readOpenSentRef.current = true;
        sendEngagement(articleId, "read_open");
      }
      if (send && Math.abs(ratio - lastSentRatioRef.current) >= 0.002) {
        lastSentRatioRef.current = ratio;
        saveProgress(articleId, ratio, keepalive);
      }
    }

    function scheduleSave() {
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          const ratio = currentRatio();
          writePosition(slug, ratio);
          if (!readOpenSentRef.current && ratio > 0.01 && document.visibilityState === "visible") {
            readOpenSentRef.current = true;
            sendEngagement(articleId, "read_open");
          }
        });
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => flush(true), SAVE_DELAY_MS);
    }

    const handlePageHide = () => flush(true, true);
    window.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener(READER_LAYOUT_CHANGE_EVENT, scheduleSave);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      if (restoreTimer) window.clearTimeout(restoreTimer);
      window.removeEventListener("scroll", scheduleSave);
      window.removeEventListener(READER_LAYOUT_CHANGE_EVENT, scheduleSave);
      window.removeEventListener("pagehide", handlePageHide);
      flush(true, true);
    };
  }, [articleId, initialRatio, readingProgressEnabled, resume, slug]);

  return null;
}
