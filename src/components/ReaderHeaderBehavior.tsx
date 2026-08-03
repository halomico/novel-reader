"use client";

import { useEffect } from "react";

const MOBILE_READER_QUERY = "(max-width: 820px)";

export function ReaderHeaderBehavior() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".readerSiteHeader");
    const reader = document.querySelector<HTMLElement>(".readerPage");
    if (!header || !reader) return;
    const shell = header.closest<HTMLElement>(".readerShell");

    const mobile = window.matchMedia(MOBILE_READER_QUERY);
    let lastScrollY = Math.max(0, window.scrollY);
    let frame = 0;
    let pointerStartY: number | null = null;
    let pointerMoved = false;

    function resetChrome() {
      header!.classList.remove("isReaderHeaderOverlay");
      shell?.style.removeProperty("--reader-header-flow-height");
      document.documentElement.classList.remove("isReaderChromeHidden");
    }

    function showCompactChrome() {
      if (window.scrollY > 24) {
        if (!header!.classList.contains("isReaderHeaderOverlay")) {
          shell?.style.setProperty("--reader-header-flow-height", `${header!.offsetHeight}px`);
        }
        header!.classList.add("isReaderHeaderOverlay");
      } else {
        header!.classList.remove("isReaderHeaderOverlay");
        shell?.style.removeProperty("--reader-header-flow-height");
      }
      document.documentElement.classList.remove("isReaderChromeHidden");
    }

    function hideChrome() {
      header!.classList.remove("isReaderHeaderOverlay");
      shell?.style.removeProperty("--reader-header-flow-height");
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
      } else if (headerHasOpenControl()) {
        showCompactChrome();
      } else if (scrollY > 24 && Math.abs(scrollY - lastScrollY) >= 6) {
        hideChrome();
      }
      lastScrollY = scrollY;
    }

    function handleScroll() {
      if (!frame) frame = window.requestAnimationFrame(updateAfterScroll);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isMobileReader()) return;
      pointerStartY = event.clientY;
      pointerMoved = false;
    }

    function handlePointerMove(event: PointerEvent) {
      if (pointerStartY !== null && Math.abs(event.clientY - pointerStartY) > 8) {
        pointerMoved = true;
      }
    }

    function handleReaderTap(event: MouseEvent) {
      if (!isMobileReader()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".readerPage") || target.closest("a, button, input, select, textarea, label")) return;
      if (pointerMoved || window.getSelection()?.toString()) {
        pointerMoved = false;
        pointerStartY = null;
        return;
      }
      const chromeHidden = document.documentElement.classList.contains("isReaderChromeHidden");
      const compactVisible = header!.classList.contains("isReaderHeaderOverlay");
      const chromeVisible = !chromeHidden && (window.scrollY <= 24 || compactVisible);
      if (chromeVisible) hideChrome();
      else showCompactChrome();
      pointerStartY = null;
    }

    function handleViewportOrModeChange() {
      if (isMobileReader()) hideChrome();
      else resetChrome();
    }

    function initializeChrome() {
      handleViewportOrModeChange();
      shell?.classList.add("isReaderChromeReady");
    }

    initializeChrome();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pageshow", initializeChrome);
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("click", handleReaderTap);
    mobile.addEventListener("change", handleViewportOrModeChange);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pageshow", initializeChrome);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("click", handleReaderTap);
      mobile.removeEventListener("change", handleViewportOrModeChange);
      header.classList.remove("isReaderHeaderOverlay");
      shell?.classList.remove("isReaderChromeReady");
      shell?.style.removeProperty("--reader-header-flow-height");
      document.documentElement.classList.remove("isReaderChromeHidden");
    };
  }, []);

  return null;
}
