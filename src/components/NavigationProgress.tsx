"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

type ProgressState = "idle" | "loading" | "complete";
type LinkNavigateEvent = { preventDefault(): void };

// The bar is armed on the click itself. CSS delays the reveal briefly, so cached
// transitions finish without a flash while slower ones get feedback at once.
const FAILSAFE_MS = 12_000;
const COMPLETE_HOLD_MS = 320;
const PENDING_CLASS = "isNavigationPending";

function isReaderDestination(pathname: string): boolean {
  return /(?:^|\/)books\/\d+(?:\/|$)/u.test(pathname) ||
    /(?:^|\/)original\/(?!new(?:\/|$)|mine(?:\/|$)|tags(?:\/|$)|author(?:\/|$))[^/]+\/?$/u.test(pathname);
}

/** A link click that loads another route of this site, or null when there is nothing to
 *  wait for: new tabs, downloads, other origins and hash-only changes. */
function linkNavigation(anchor: HTMLAnchorElement): { readerNavigation: boolean } | null {
  if (
    (anchor.target && anchor.target !== "_self") ||
    anchor.hasAttribute("download") ||
    anchor.getAttribute("aria-disabled") === "true"
  ) return null;
  const destination = new URL(anchor.href, window.location.href);
  if (destination.origin !== window.location.origin) return null;
  if (destination.pathname === window.location.pathname && destination.search === window.location.search) return null;
  return { readerNavigation: Boolean(anchor.closest(".readerShell")) && isReaderDestination(destination.pathname) };
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

/**
 * Next's Link cancels the native click to navigate on the client, so the document click
 * listener below never sees Link navigations. Link wrappers report them instead: the
 * click records which anchor was pressed, and `onNavigate` fires only when Link really
 * navigates (not for modified clicks, and not when a caller cancels it).
 */
export function useLinkNavigationProgress(
  onClick: ((event: ReactMouseEvent<HTMLAnchorElement>) => void) | undefined,
  onNavigate: ((event: LinkNavigateEvent) => void) | undefined,
) {
  const anchorRef = useRef<HTMLAnchorElement | null>(null);
  return {
    onClick(event: ReactMouseEvent<HTMLAnchorElement>) {
      anchorRef.current = event.currentTarget;
      onClick?.(event);
    },
    onNavigate(event: LinkNavigateEvent) {
      let cancelled = false;
      onNavigate?.({ preventDefault() { cancelled = true; event.preventDefault(); } });
      if (cancelled) return;
      const navigation = anchorRef.current ? linkNavigation(anchorRef.current) : { readerNavigation: false };
      if (navigation) dispatchNavigationProgress(navigation.readerNavigation);
    },
  };
}

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const previousRouteRef = useRef(routeKey);
  const finishRef = useRef<() => void>(() => undefined);
  const [state, setState] = useState<ProgressState>("idle");

  useEffect(() => {
    const root = document.documentElement;
    let failsafeTimer: ReturnType<typeof setTimeout> | null = null;
    let completeTimer: ReturnType<typeof setTimeout> | null = null;
    let startFrame = 0;

    function clearTimers() {
      if (failsafeTimer) clearTimeout(failsafeTimer);
      if (completeTimer) clearTimeout(completeTimer);
      if (startFrame) cancelAnimationFrame(startFrame);
      failsafeTimer = null;
      completeTimer = null;
      startFrame = 0;
    }

    function finish() {
      root.classList.remove("isReaderPagePending", PENDING_CLASS);
      clearTimers();
      setState((current) => {
        if (current === "idle") return current;
        completeTimer = setTimeout(() => setState("idle"), COMPLETE_HOLD_MS);
        return "complete";
      });
    }

    function start(readerNavigation = false) {
      clearTimers();
      root.classList.add(PENDING_CLASS);
      root.classList.toggle("isReaderPagePending", readerNavigation);
      failsafeTimer = setTimeout(finish, FAILSAFE_MS);
      if (document.visibilityState !== "visible") {
        setState("loading");
        return;
      }
      // Reset to the empty track for one painted frame so a new navigation never
      // animates backwards out of a previous "complete" state.
      setState("idle");
      startFrame = requestAnimationFrame(() => {
        startFrame = requestAnimationFrame(() => {
          startFrame = 0;
          setState("loading");
        });
      });
    }

    // Plain anchors only: Link clicks arrive already cancelled and are reported
    // through useLinkNavigationProgress.
    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      const navigation = target ? linkNavigation(target) : null;
      if (navigation) start(navigation.readerNavigation);
    }

    const handleManualStart = (event: Event) => {
      const detail = (event as CustomEvent<{ readerNavigation?: boolean }>).detail;
      start(Boolean(detail?.readerNavigation));
    };

    finishRef.current = finish;
    // Listen after component handlers so preventDefault() can cancel feedback.
    document.addEventListener("click", handleDocumentClick);
    window.addEventListener("novel:navigation-start", handleManualStart);
    window.addEventListener("pageshow", finish);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
      window.removeEventListener("novel:navigation-start", handleManualStart);
      window.removeEventListener("pageshow", finish);
      clearTimers();
      finishRef.current = () => undefined;
      root.classList.remove("isReaderPagePending", PENDING_CLASS);
    };
  }, []);

  useEffect(() => {
    if (previousRouteRef.current === routeKey) return;
    previousRouteRef.current = routeKey;
    finishRef.current();
  }, [routeKey]);

  return <span className="navigationProgress" data-state={state} aria-hidden="true" />;
}
