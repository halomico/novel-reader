"use client";

import { useEffect } from "react";

const MOBILE_READER_QUERY = "(max-width: 820px)";

export function ReaderHeaderBehavior() {
  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".readerSiteHeader");
    const reader = document.querySelector<HTMLElement>(".readerPage");
    if (!header || !reader) return;

    const mobile = window.matchMedia(MOBILE_READER_QUERY);
    let lastScrollY = Math.max(0, window.scrollY);
    let frame = 0;
    let pointerStartY: number | null = null;
    let pointerMoved = false;

    function showHeader() {
      header!.classList.remove("isReaderHeaderHidden");
    }

    function isMinimalMobileReader() {
      return mobile.matches && document.documentElement.dataset.uiMode === "minimal";
    }

    function headerHasOpenControl() {
      return Boolean(header!.querySelector('.readerSearchForm.isPinnedOpen, .userMenuButton[aria-expanded="true"]'));
    }

    function updateAfterScroll() {
      frame = 0;
      const scrollY = Math.max(0, window.scrollY);
      if (!isMinimalMobileReader() || scrollY <= 24 || headerHasOpenControl()) {
        showHeader();
      } else if (Math.abs(scrollY - lastScrollY) >= 6) {
        header!.classList.add("isReaderHeaderHidden");
      }
      lastScrollY = scrollY;
    }

    function handleScroll() {
      if (!frame) frame = window.requestAnimationFrame(updateAfterScroll);
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isMinimalMobileReader()) return;
      pointerStartY = event.clientY;
      pointerMoved = false;
    }

    function handlePointerMove(event: PointerEvent) {
      if (pointerStartY !== null && Math.abs(event.clientY - pointerStartY) > 8) {
        pointerMoved = true;
      }
    }

    function handleReaderTap(event: MouseEvent) {
      if (!isMinimalMobileReader()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".readerPage") || target.closest("a, button, input, select, textarea, label")) return;
      if (pointerMoved || window.getSelection()?.toString()) {
        pointerMoved = false;
        pointerStartY = null;
        return;
      }
      header!.classList.toggle("isReaderHeaderHidden");
      pointerStartY = null;
    }

    function handleViewportOrModeChange() {
      if (!isMinimalMobileReader()) showHeader();
    }

    const modeObserver = new MutationObserver(handleViewportOrModeChange);
    updateAfterScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pageshow", showHeader);
    document.addEventListener("pointerdown", handlePointerDown, { passive: true });
    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("click", handleReaderTap);
    mobile.addEventListener("change", handleViewportOrModeChange);
    modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-ui-mode"] });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pageshow", showHeader);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("click", handleReaderTap);
      mobile.removeEventListener("change", handleViewportOrModeChange);
      modeObserver.disconnect();
      header.classList.remove("isReaderHeaderHidden");
    };
  }, []);

  function scrollToTop() {
    document.querySelector<HTMLElement>(".readerSiteHeader")?.classList.remove("isReaderHeaderHidden");
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }

  return (
    <button
      className="readerHeaderTopArea"
      type="button"
      onClick={scrollToTop}
      aria-label="返回顶部"
      title="返回顶部"
    />
  );
}
