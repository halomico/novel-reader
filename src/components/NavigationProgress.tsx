"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type ProgressState = "idle" | "loading" | "complete";

const SHOW_DELAY_MS = 140;
const FAILSAFE_MS = 12_000;

function isReaderDestination(pathname: string): boolean {
  return /(?:^|\/)books\/\d+(?:\/|$)/u.test(pathname) ||
    /(?:^|\/)original\/(?!new(?:\/|$)|mine(?:\/|$)|tags(?:\/|$)|author(?:\/|$))[^/]+\/?$/u.test(pathname);
}

function dispatchNavigationProgress(readerNavigation: boolean) {
  window.dispatchEvent(new CustomEvent("novel:navigation-start", {
    detail: { readerNavigation },
  }));
}

export function beginNavigationProgress() {
  dispatchNavigationProgress(false);
}

export function beginReaderNavigationProgress() {
  dispatchNavigationProgress(true);
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteRef = useRef(routeKey);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const completeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<ProgressState>("idle");

  useEffect(() => {
    function clearTimers() {
      if (showTimerRef.current) clearTimeout(showTimerRef.current);
      if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
      if (completeTimerRef.current) clearTimeout(completeTimerRef.current);
      showTimerRef.current = null;
      failsafeTimerRef.current = null;
      completeTimerRef.current = null;
    }

    function finish() {
      document.documentElement.classList.remove("isReaderPagePending");
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      if (failsafeTimerRef.current) {
        clearTimeout(failsafeTimerRef.current);
        failsafeTimerRef.current = null;
      }
      setState((current) => {
        if (current === "idle") return current;
        completeTimerRef.current = setTimeout(() => setState("idle"), 180);
        return "complete";
      });
    }

    function start(readerNavigation = false) {
      clearTimers();
      setState("idle");
      document.documentElement.classList.toggle("isReaderPagePending", readerNavigation);
      showTimerRef.current = setTimeout(() => setState("loading"), SHOW_DELAY_MS);
      failsafeTimerRef.current = setTimeout(finish, FAILSAFE_MS);
    }

    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (
        !target ||
        target.target ||
        target.hasAttribute("download") ||
        target.getAttribute("aria-disabled") === "true"
      ) return;

      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search &&
        destination.hash
      ) {
        return;
      }
      if (destination.href !== window.location.href) {
        start(Boolean(target.closest(".readerShell")) && isReaderDestination(destination.pathname));
      }
    }

    const handleManualStart = (event: Event) => {
      const detail = (event as CustomEvent<{ readerNavigation?: boolean }>).detail;
      start(Boolean(detail?.readerNavigation));
    };

    // Listen after component handlers so preventDefault() can cancel feedback.
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("novel:navigation-start", handleManualStart);
    window.addEventListener("pageshow", finish);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("novel:navigation-start", handleManualStart);
      window.removeEventListener("pageshow", finish);
      clearTimers();
      document.documentElement.classList.remove("isReaderPagePending");
    };
  }, []);

  useEffect(() => {
    if (previousRouteRef.current === routeKey) return;
    previousRouteRef.current = routeKey;
    document.documentElement.classList.remove("isReaderPagePending");
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (failsafeTimerRef.current) {
      clearTimeout(failsafeTimerRef.current);
      failsafeTimerRef.current = null;
    }
    setState((current) => {
      if (current === "idle") return current;
      completeTimerRef.current = setTimeout(() => setState("idle"), 180);
      return "complete";
    });
  }, [routeKey]);

  return <span className="navigationProgress" data-state={state} aria-hidden="true" />;
}
