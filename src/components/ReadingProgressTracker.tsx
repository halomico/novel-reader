"use client";

import { useEffect, useRef } from "react";
import type { ReadingProgress } from "@/lib/reading-progress";
import { READER_LAYOUT_CHANGE_EVENT, resolveReaderPageMetrics } from "@/lib/reader-layout";
import { normalizeReaderPageTurn } from "@/lib/ui-preferences";

type StoredProgress = {
  novelId: number;
  chapterId: number | null;
  segmentIndex: number;
  segmentRatio: number;
  progressPercent: number;
  contentVersion: string;
  completed: boolean;
  savedAt: number;
};

const STORAGE_PREFIX = "novel-reader:reading-progress:";
const MAX_LOCAL_ITEMS = 30;
const SYNC_INTERVAL_MS = 20_000;
const MOBILE_READER_QUERY = "(max-width: 820px)";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function storageKey(userId: number): string {
  return `${STORAGE_PREFIX}${userId}`;
}

function readStoredProgress(userId: number, novelId: number): StoredProgress | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || "[]") as StoredProgress[];
    return parsed.find((item) => item.novelId === novelId) || null;
  } catch {
    return null;
  }
}

function writeStoredProgress(userId: number, progress: StoredProgress) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || "[]") as StoredProgress[];
    const next = [progress, ...parsed.filter((item) => item.novelId !== progress.novelId)]
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, MAX_LOCAL_ITEMS);
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    // Server synchronization remains available when local storage is unavailable.
  }
}

function progressChanged(left: StoredProgress | null, right: StoredProgress): boolean {
  return !left ||
    left.contentVersion !== right.contentVersion ||
    left.segmentIndex !== right.segmentIndex ||
    Math.abs(left.segmentRatio - right.segmentRatio) >= 0.02 ||
    Math.abs(left.progressPercent - right.progressPercent) >= 0.5 ||
    left.completed !== right.completed;
}

function scrollToProgress(
  progress: Pick<StoredProgress, "segmentIndex" | "segmentRatio">,
  totalSegments: number,
) {
  const segment = document.querySelector<HTMLElement>(
    `.readerSegment[data-segment-index="${progress.segmentIndex}"]`,
  );
  if (!segment) return;
  const readerText = document.querySelector<HTMLElement>(".readerText");
  if (
    readerText &&
    window.matchMedia(MOBILE_READER_QUERY).matches &&
    normalizeReaderPageTurn(document.documentElement.dataset.readerPageTurn) !== "scroll"
  ) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const localRatio = (progress.segmentIndex + clamp(progress.segmentRatio, 0, 1)) / Math.max(totalSegments, 1);
      const renderedGap = Number.parseFloat(getComputedStyle(readerText).columnGap);
      const metrics = resolveReaderPageMetrics({
        viewportWidth: readerText.getBoundingClientRect().width,
        scrollWidth: readerText.scrollWidth,
        scrollLeft: readerText.scrollLeft,
        pageGap: Number.isFinite(renderedGap) ? renderedGap : 0,
      });
      const targetIndex = Math.round(localRatio * Math.max(metrics.count - 1, 0));
      readerText.scrollTo({ left: targetIndex * metrics.stride, behavior: "auto" });
    }));
    return;
  }
  const header = document.querySelector<HTMLElement>(".readerSiteHeader");
  const headerOffset = header?.getBoundingClientRect().height || 0;
  const target = window.scrollY + segment.getBoundingClientRect().top +
    segment.offsetHeight * clamp(progress.segmentRatio, 0, 1) -
    headerOffset - 20;
  window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
}

export function ReadingProgressTracker({
  novelId,
  chapterId = null,
  chapterIndex = 0,
  totalChapters = 1,
  userId,
  contentVersion,
  totalSegments,
  initialProgress,
  resume,
}: {
  novelId: number;
  chapterId?: number | null;
  chapterIndex?: number;
  totalChapters?: number;
  userId: number;
  contentVersion: string;
  totalSegments: number;
  initialProgress: ReadingProgress | null;
  resume: boolean;
}) {
  const currentRef = useRef<StoredProgress | null>(null);
  const sentRef = useRef<StoredProgress | null>(
    initialProgress
      ? {
          novelId,
          chapterId: initialProgress.chapterId,
          segmentIndex: initialProgress.segmentIndex,
          segmentRatio: initialProgress.segmentRatio,
          progressPercent: initialProgress.progressPercent,
          contentVersion: initialProgress.contentVersion,
          completed: initialProgress.completed,
          savedAt: Date.parse(initialProgress.lastReadAt) || 0,
        }
      : null,
  );
  const interactedRef = useRef(false);
  const flushTimerRef = useRef<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const local = readStoredProgress(userId, novelId);
    const server = sentRef.current;
    const validLocal = local?.contentVersion === contentVersion && local.chapterId === chapterId ? local : null;
    const validServer = server?.contentVersion === contentVersion && server.chapterId === chapterId ? server : null;
    const resumeProgress = validLocal && (!validServer || validLocal.savedAt > validServer.savedAt)
      ? validLocal
      : validServer;

    if (resume && resumeProgress) {
      window.requestAnimationFrame(() => {
        scrollToProgress(resumeProgress, totalSegments);
        const url = new URL(window.location.href);
        url.searchParams.delete("resume");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      });
    }

    function measureProgress() {
      frameRef.current = null;
      if (!totalSegments) return;
      const readerText = document.querySelector<HTMLElement>(".readerText");
      const paged = Boolean(readerText) &&
        window.matchMedia(MOBILE_READER_QUERY).matches &&
        normalizeReaderPageTurn(document.documentElement.dataset.readerPageTurn) !== "scroll";
      const readerRect = readerText?.getBoundingClientRect();
      const probeY = paged && readerRect
        ? clamp(readerRect.top + readerRect.height * 0.42, readerRect.top + 12, readerRect.bottom - 12)
        : clamp(window.innerHeight * 0.42, 80, Math.max(window.innerHeight - 80, 80));
      const probeX = paged && readerRect
        ? clamp(readerRect.left + readerRect.width * 0.5, readerRect.left + 12, readerRect.right - 12)
        : window.innerWidth / 2;
      const target = document.elementFromPoint(probeX, probeY);
      const readingEndReached = paged && readerText
        ? readerText.scrollLeft + readerText.clientWidth >= readerText.scrollWidth - 24
        : window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80;
      const segment = target?.closest<HTMLElement>(".readerSegment") ||
        (readingEndReached
          ? document.querySelector<HTMLElement>(".readerSegment:last-of-type")
          : null);
      if (!segment) return;
      const segmentIndex = Math.max(Number(segment.dataset.segmentIndex || 0), 0);
      const segmentRects = paged
        ? Array.from(segment.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
        : [];
      const fragmentIndex = segmentRects.findIndex((rect) => (
        probeX >= rect.left && probeX <= rect.right && probeY >= rect.top && probeY <= rect.bottom
      ));
      const activeRect = fragmentIndex >= 0 ? segmentRects[fragmentIndex] : segment.getBoundingClientRect();
      const segmentRatio = paged && fragmentIndex >= 0
        ? clamp((fragmentIndex + (probeY - activeRect.top) / Math.max(activeRect.height, 1)) / segmentRects.length, 0, 1)
        : activeRect.height > 0 ? clamp((probeY - activeRect.top) / activeRect.height, 0, 1) : 0;
      const localProgress = (segmentIndex + segmentRatio) / totalSegments;
      const progressPercent = clamp(((chapterIndex + localProgress) / totalChapters) * 100, 0, 100);
      const lastChapter = chapterIndex >= totalChapters - 1;
      const next: StoredProgress = {
        novelId,
        chapterId,
        segmentIndex,
        segmentRatio,
        progressPercent,
        contentVersion,
        completed: (lastChapter && readingEndReached) || progressPercent >= 98,
        savedAt: Date.now(),
      };
      currentRef.current = next;
      writeStoredProgress(userId, next);
    }

    function scheduleMeasure(interacted = true) {
      if (interacted) {
        interactedRef.current = true;
      }
      if (frameRef.current === null) {
        frameRef.current = window.requestAnimationFrame(measureProgress);
      }
    }

    function flush() {
      const current = currentRef.current;
      if (
        !interactedRef.current ||
        !current ||
        !progressChanged(sentRef.current, current)
      ) {
        return;
      }
      sentRef.current = current;
      void fetch("/api/account/reading-progress", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current),
        credentials: "same-origin",
        keepalive: true,
      }).catch(() => undefined);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        measureProgress();
        flush();
      }
    }

    const onScroll = () => scheduleMeasure(true);
    const onReaderScroll = () => scheduleMeasure(true);
    const onResize = () => scheduleMeasure(false);
    const onReaderLayout = () => scheduleMeasure(false);
    const onPageHide = () => {
      measureProgress();
      flush();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const readerText = document.querySelector<HTMLElement>(".readerText");
    readerText?.addEventListener("scroll", onReaderScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener(READER_LAYOUT_CHANGE_EVENT, onReaderLayout);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    flushTimerRef.current = window.setInterval(flush, SYNC_INTERVAL_MS);

    return () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (flushTimerRef.current !== null) window.clearInterval(flushTimerRef.current);
      measureProgress();
      flush();
      window.removeEventListener("scroll", onScroll);
      readerText?.removeEventListener("scroll", onReaderScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener(READER_LAYOUT_CHANGE_EVENT, onReaderLayout);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [chapterId, chapterIndex, contentVersion, novelId, resume, totalChapters, totalSegments, userId]);

  return null;
}
