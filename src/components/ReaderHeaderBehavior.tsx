"use client";

import { useEffect } from "react";
import {
  READER_CHROME_SHOW_EVENT,
  READER_KEEP_CHROME_SESSION_KEY,
} from "@/lib/reader-layout";

const MOBILE_READER_QUERY = "(max-width: 820px)";

export function ReaderHeaderBehavior({ hideOnScroll = true }: { hideOnScroll?: boolean }) {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".readerSiteHeader");
    const reader = document.querySelector<HTMLElement>(".readerPage");
    if (!header || !reader) return;
    const shell = header.closest<HTMLElement>(".readerShell");

    const mobile = window.matchMedia(MOBILE_READER_QUERY);
    let lastScrollY = Math.max(0, window.scrollY);
    let frame = 0;
    let keepChromeTimer = 0;
    let pointerStart: { x: number; y: number } | null = null;
    let pointerMoved = false;

    function resetChrome() {
      header!.classList.remove("isReaderHeaderOverlay");
      document.documentElement.classList.remove("isReaderChromeHidden");
    }

    function showCompactChrome() {
      if (window.scrollY > 24) {
        header!.classList.add("isReaderHeaderOverlay");
      } else {
        header!.classList.remove("isReaderHeaderOverlay");
      }
      document.documentElement.classList.remove("isReaderChromeHidden");
    }

    function hideChrome() {
      sessionStorage.removeItem(READER_KEEP_CHROME_SESSION_KEY);
      header!.classList.remove("isReaderHeaderOverlay");
      document.documentElement.classList.add("isReaderChromeHidden");
    }

    function isMobileReader() {
      return mobile.matches;
    }

    function headerHasOpenControl() {
      return Boolean(header!.querySelector('.readerSearchForm.isPinnedOpen, .userMenuButton[aria-expanded="true"]'));
    }

    function updateAfterScroll() {
      frame = 0;
      const scrollY = Math.max(0, window.scrollY);
      if (!isMobileReader()) {
        resetChrome();
      } else if (sessionStorage.getItem(READER_KEEP_CHROME_SESSION_KEY) === "1") {
        showCompactChrome();
      } else if (headerHasOpenControl()) {
        showCompactChrome();
      } else if (hideOnScroll && scrollY > 24 && Math.abs(scrollY - lastScrollY) >= 6) {
        hideChrome();
      }
      lastScrollY = scrollY;
    }

    function handleScroll() {
      if (!frame) frame = window.requestAnimationFrame(updateAfterScroll);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isMobileReader()) return;
      pointerStart = { x: event.clientX, y: event.clientY };
      pointerMoved = false;
    }

    function handlePointerMove(event: PointerEvent) {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 8) {
        pointerMoved = true;
      }
    }

    function handleReaderTap(event: MouseEvent) {
      if (!isMobileReader()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".readerPage") || target.closest("a, button, input, select, textarea, label")) return;
      if (pointerMoved || window.getSelection()?.toString()) {
        pointerMoved = false;
        pointerStart = null;
        return;
      }
      const chromeHidden = document.documentElement.classList.contains("isReaderChromeHidden");
      const compactVisible = header!.classList.contains("isReaderHeaderOverlay");
      const chromeVisible = !chromeHidden && (window.scrollY <= 24 || compactVisible);
      if (chromeVisible) hideChrome();
      else showCompactChrome();
      pointerStart = null;
    }

    function handleViewportOrModeChange() {
      if (isMobileReader()) hideChrome();
      else resetChrome();
    }

    function initializeChrome() {
      const keepChrome = sessionStorage.getItem(READER_KEEP_CHROME_SESSION_KEY) === "1";
      if (isMobileReader() && keepChrome) {
        showCompactChrome();
        window.clearTimeout(keepChromeTimer);
        keepChromeTimer = window.setTimeout(() => {
          sessionStorage.removeItem(READER_KEEP_CHROME_SESSION_KEY);
        }, 1600);
      } else handleViewportOrModeChange();
      shell?.classList.add("isReaderChromeReady");
    }

    initializeChrome();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pageshow", initializeChrome);
    window.addEventListener(READER_CHROME_SHOW_EVENT, showCompactChrome);
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("click", handleReaderTap);
    mobile.addEventListener("change", handleViewportOrModeChange);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(keepChromeTimer);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pageshow", initializeChrome);
      window.removeEventListener(READER_CHROME_SHOW_EVENT, showCompactChrome);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("click", handleReaderTap);
      mobile.removeEventListener("change", handleViewportOrModeChange);
      header.classList.remove("isReaderHeaderOverlay");
      shell?.classList.remove("isReaderChromeReady");
      document.documentElement.classList.remove("isReaderChromeHidden");
    };
  }, [hideOnScroll]);

  return null;
}
