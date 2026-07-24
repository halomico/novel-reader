"use client";

import { ArrowUp } from "lucide-react";
import { useEffect, useState } from "react";

const MOBILE_READER_QUERY = "(max-width: 820px)";
const TOP_BUTTON_THRESHOLD = 320;

export function ReaderHeaderBehavior() {
  const [showTopButton, setShowTopButton] = useState(false);

  useEffect(() => {
    const header = document.querySelector<HTMLElement>(".readerSiteHeader");
    const reader = document.querySelector<HTMLElement>(".readerPage");
    if (!header || !reader) return;

    const mobile = window.matchMedia(MOBILE_READER_QUERY);
    let lastScrollY = Math.max(0, window.scrollY);
    let frame = 0;

    function showHeader() {
      header!.classList.remove("isReaderHeaderHidden");
    }

    function headerHasOpenControl() {
      return Boolean(header!.querySelector('.readerSearchForm.isPinnedOpen, .userMenuButton[aria-expanded="true"]'));
    }

    function updateAfterScroll() {
      frame = 0;
      const scrollY = Math.max(0, window.scrollY);
      setShowTopButton((current) => {
        const next = scrollY > TOP_BUTTON_THRESHOLD;
        return current === next ? current : next;
      });

      if (!mobile.matches || scrollY <= 24 || headerHasOpenControl()) {
        showHeader();
      } else if (Math.abs(scrollY - lastScrollY) >= 6) {
        header!.classList.add("isReaderHeaderHidden");
      }
      lastScrollY = scrollY;
    }

    function handleScroll() {
      if (!frame) frame = window.requestAnimationFrame(updateAfterScroll);
    }

    function handleReaderTap(event: MouseEvent) {
      if (!mobile.matches || !header!.classList.contains("isReaderHeaderHidden")) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".readerPage") || target.closest("a, button, input, select, textarea, label")) return;
      if (window.getSelection()?.toString()) return;
      showHeader();
    }

    function handleViewportChange() {
      if (!mobile.matches) showHeader();
    }

    updateAfterScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pageshow", showHeader);
    document.addEventListener("click", handleReaderTap);
    mobile.addEventListener("change", handleViewportChange);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pageshow", showHeader);
      document.removeEventListener("click", handleReaderTap);
      mobile.removeEventListener("change", handleViewportChange);
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
      className={showTopButton ? "readerHeaderTopButton isVisible" : "readerHeaderTopButton"}
      type="button"
      onClick={scrollToTop}
      aria-label="返回顶部"
      title="返回顶部"
    >
      <ArrowUp size={18} aria-hidden="true" />
    </button>
  );
}
