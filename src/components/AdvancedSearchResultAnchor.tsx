"use client";

import { useEffect, useRef } from "react";
import { ResultCount } from "./ResultCount";

export function AdvancedSearchResultAnchor({ count, scrollKey }: { count?: number; scrollKey: string }) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.location.hash !== "#advanced-search-results") return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const anchor = anchorRef.current;
        if (!anchor) return;
        const header = document.querySelector<HTMLElement>(".siteHeader");
        const offset = (header?.getBoundingClientRect().height || 0) + 12;
        const top = anchor.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [scrollKey]);

  return (
    <div
      className={count === undefined ? "advancedSearchResultsAnchor" : "advancedSearchResultsAnchor resultCountBar"}
      id="advanced-search-results"
      ref={anchorRef}
    >
      {count === undefined ? null : <ResultCount count={count} />}
    </div>
  );
}
