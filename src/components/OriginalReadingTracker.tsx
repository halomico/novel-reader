"use client";

import { useEffect, useRef } from "react";
import { READER_LAYOUT_CHANGE_EVENT } from "@/lib/reader-layout";

const STORAGE_PREFIX = "novel-reader:original-reading-position:";
const SAVE_DELAY_MS = 900;

type StoredPosition = { ratio?: number; top?: number };

function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(slug)}`;
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

function saveToServer(articleId: number, ratio: number, keepalive = false): void {
  void fetch("/api/account/original-reading-progress", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articleId, scrollRatio: ratio }),
    keepalive,
  }).catch(() => undefined);
}

/** Persists a position relative to the article body, excluding comments and
 * surrounding page chrome, so the same ratio restores reliably on both
 * desktop and mobile layouts. */
export function OriginalReadingTracker({
  articleId,
  slug,
  enabled,
  resume,
  initialRatio = 0,
}: {
  articleId: number;
  slug: string;
  enabled: boolean;
  resume: boolean;
  initialRatio?: number;
}) {
  const frameRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastSentRatioRef = useRef(initialRatio);

  useEffect(() => {
    if (!enabled) {
      try {
        window.localStorage.removeItem(storageKey(slug));
      } catch {
        // Ignore storage policy errors.
      }
      return;
    }

    const local = readPosition(slug);
    const saved = initialRatio > 0 ? { ratio: initialRatio } : local;
    if (resume && saved) {
      const restore = () => window.requestAnimationFrame(() => window.requestAnimationFrame(() => restorePosition(saved)));
      if (document.fonts?.ready) void document.fonts.ready.then(restore);
      else restore();
    }
    if (resume) {
      const url = new URL(window.location.href);
      url.searchParams.delete("resume");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }

    function flush(send = true, keepalive = false) {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const ratio = currentRatio();
      writePosition(slug, ratio);
      if (send && Math.abs(ratio - lastSentRatioRef.current) >= 0.002) {
        lastSentRatioRef.current = ratio;
        saveToServer(articleId, ratio, keepalive);
      }
    }

    function scheduleSave() {
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(() => {
          frameRef.current = null;
          writePosition(slug, currentRatio());
        });
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => flush(true), SAVE_DELAY_MS);
    }

    function handlePageHide() {
      flush(true, true);
    }

    window.addEventListener("scroll", scheduleSave, { passive: true });
    window.addEventListener(READER_LAYOUT_CHANGE_EVENT, scheduleSave);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("scroll", scheduleSave);
      window.removeEventListener(READER_LAYOUT_CHANGE_EVENT, scheduleSave);
      window.removeEventListener("pagehide", handlePageHide);
      flush(true, true);
    };
  }, [articleId, enabled, initialRatio, resume, slug]);

  return null;
}
