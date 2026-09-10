"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { beginReaderNavigationProgress } from "@/components/NavigationProgress";
import { localeFromPathname, withLocalePath } from "@/lib/locale";
import {
  READER_CHROME_SHOW_EVENT,
  READER_ENTRY_EDGE_SESSION_KEY,
  READER_KEEP_CHROME_SESSION_KEY,
  READER_LAYOUT_CHANGE_EVENT,
  READER_PAGE_REQUEST_EVENT,
  READER_PAGE_STATE_EVENT,
  READER_PAGE_STATE_REQUEST_EVENT,
  READER_PAGE_TURN_CHANGE_EVENT,
  encodeReaderEntryEdge,
  resolveReaderEntryEdge,
  resolveReaderEntryPage,
  resolveReaderPageMetrics,
  resolveReaderDragTarget,
  shouldPrefetchReaderRoute,
  type ReaderPageState,
} from "@/lib/reader-layout";
import { normalizeReaderPageTurn, type ReaderPageTurn } from "@/lib/ui-preferences";

type ReaderPageMetrics = {
  count: number;
  index: number;
  stride: number;
};

type DragState = {
  pointerId: number;
  startX: number;
  startLeft: number;
  startIndex: number;
  startedAt: number;
  moved: boolean;
};

const MOBILE_READER_QUERY = "(max-width: 820px)";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function columnGeometry(content: HTMLElement) {
  const style = getComputedStyle(content);
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(style.paddingRight) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  const pageGap = Number.parseFloat(style.columnGap);
  return {
    pageGap: Number.isFinite(pageGap) ? Math.max(pageGap, 0) : 0,
    pageWidth: Math.max(
      content.getBoundingClientRect().width - borderLeft - borderRight - paddingLeft - paddingRight,
      1,
    ),
    paddingInline: paddingLeft + paddingRight,
  };
}

function pageMetrics(content: HTMLElement): ReaderPageMetrics {
  const geometry = columnGeometry(content);
  return resolveReaderPageMetrics({
    viewportWidth: geometry.pageWidth,
    scrollWidth: Math.max(content.scrollWidth - geometry.paddingInline, geometry.pageWidth),
    scrollLeft: content.scrollLeft,
    pageGap: geometry.pageGap,
  });
}

export function ReaderPageTurnController({
  previousHref,
  nextHref,
  previousContentBytes,
  nextContentBytes,
}: {
  previousHref?: string | null;
  nextHref?: string | null;
  previousContentBytes?: number | null;
  nextContentBytes?: number | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const locale = localeFromPathname(pathname);
  const modeRef = useRef<ReaderPageTurn>("scroll");
  const previousPathRef = useRef(pathname);

  useLayoutEffect(() => {
    const routeChanged = previousPathRef.current !== pathname;
    previousPathRef.current = pathname;
    const root = document.documentElement;
    const content = document.querySelector<HTMLElement>(".readerText");
    if (!content) return;
    const shell = content.closest<HTMLElement>(".readerShell");
    const mobile = window.matchMedia(MOBILE_READER_QUERY);
    let metrics = pageMetrics(content);
    let drag: DragState | null = null;
    let layoutFrame = 0;
    let settleFrame = 0;
    let animationFrame = 0;
    let scrollFrame = 0;
    let routeFrame = 0;
    let enteringFrame = 0;
    let entryAnchorTimer = 0;
    let entryAnchor: "start" | "end" | null = null;
    let navigating = false;
    let suppressClickUntil = 0;
    let lastSize = { width: content.getBoundingClientRect().width, height: content.clientHeight };

    function isPaged(): boolean {
      return mobile.matches && modeRef.current !== "scroll";
    }

    function emitState() {
      if (isPaged()) metrics = pageMetrics(content!);
      const state: ReaderPageState = {
        paged: isPaged(),
        index: isPaged() ? metrics.index : 0,
        count: isPaged() ? metrics.count : 1,
        canPrevious: isPaged() ? metrics.index > 0 || Boolean(previousHref) : Boolean(previousHref),
        canNext: isPaged() ? metrics.index < metrics.count - 1 || Boolean(nextHref) : Boolean(nextHref),
      };
      shell?.classList.toggle("isReaderPageEnd", state.paged && state.index >= state.count - 1);
      window.dispatchEvent(new CustomEvent<ReaderPageState>(READER_PAGE_STATE_EVENT, { detail: state }));
    }

    function configureColumns() {
      if (!content) return;
      const width = Math.round(columnGeometry(content).pageWidth);
      if (width > 0 && content.style.getPropertyValue("--reader-page-column-width") !== `${width}px`) {
        content.style.setProperty("--reader-page-column-width", `${width}px`);
      }
    }

    function afterLayout(callback: (settled: boolean) => void) {
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
      configureColumns();
      callback(false);
      settleFrame = requestAnimationFrame(() => {
        settleFrame = 0;
        callback(true);
      });
    }

    function cancelAnimation() {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    function setLeft(left: number) {
      const maximum = Math.max(content!.scrollWidth - content!.clientWidth, 0);
      content!.scrollLeft = clamp(left, 0, maximum);
    }

    function settleTo(index: number, animated: boolean) {
      metrics = pageMetrics(content!);
      const targetIndex = clamp(index, 0, metrics.count - 1);
      const targetLeft = targetIndex * metrics.stride;
      cancelAnimation();
      if (!animated || matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setLeft(targetLeft);
        metrics = { ...metrics, index: targetIndex };
        emitState();
        return;
      }

      const startLeft = content!.scrollLeft;
      const distance = targetLeft - startLeft;
      const startedAt = performance.now();
      const animate = (now: number) => {
        const progress = clamp((now - startedAt) / 150, 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        setLeft(startLeft + distance * eased);
        if (progress < 1) {
          animationFrame = requestAnimationFrame(animate);
          return;
        }
        animationFrame = 0;
        setLeft(targetLeft);
        metrics = { ...pageMetrics(content!), index: targetIndex };
        emitState();
      };
      animationFrame = requestAnimationFrame(animate);
    }

    function navigate(href: string | null | undefined, direction: -1 | 1, keepChrome: boolean): boolean {
      if (!href) return false;
      if (navigating) return true;
      navigating = true;
      if (keepChrome) {
        sessionStorage.setItem(READER_KEEP_CHROME_SESSION_KEY, "1");
        window.dispatchEvent(new Event(READER_CHROME_SHOW_EVENT));
      }
      const destination = withLocalePath(href, locale);
      sessionStorage.setItem(
        READER_ENTRY_EDGE_SESSION_KEY,
        encodeReaderEntryEdge(destination, direction < 0 ? "end" : "start"),
      );
      const push = () => {
        beginReaderNavigationProgress();
        router.push(destination, { scroll: false });
      };
      if (modeRef.current === "slide" && shell && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        shell.classList.add(direction < 0 ? "isReaderRouteLeavingPrevious" : "isReaderRouteLeavingNext");
        // Let the browser paint the outgoing offset, then start the route
        // request immediately. Waiting for the CSS transition here makes a
        // boundary turn feel stuck while the next document is fetched.
        routeFrame = requestAnimationFrame(() => {
          routeFrame = 0;
          push();
        });
      } else {
        push();
      }
      return true;
    }

    function turnBy(direction: -1 | 1, keepChrome = false) {
      if (!isPaged()) return;
      metrics = pageMetrics(content!);
      const nextIndex = metrics.index + direction;
      if (nextIndex < 0 && navigate(previousHref, -1, keepChrome)) return;
      if (nextIndex >= metrics.count && navigate(nextHref, 1, keepChrome)) return;
      settleTo(nextIndex, modeRef.current === "slide");
    }

    function pagedRatio(): number {
      const maximum = Math.max(content!.scrollWidth - content!.clientWidth, 0);
      return maximum ? clamp(content!.scrollLeft / maximum, 0, 1) : 0;
    }

    function restoreVerticalProgress(progressRatio: number) {
      const contentTop = window.scrollY + content!.getBoundingClientRect().top;
      const target = contentTop + content!.scrollHeight * clamp(progressRatio, 0, 1) - window.innerHeight * 0.42;
      window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    }

    function syncMode(progressRatio?: number) {
      const wasPaged = isPaged();
      const currentPagedRatio = wasPaged ? pagedRatio() : undefined;
      const requestedMode = normalizeReaderPageTurn(root.dataset.readerPageTurn);
      modeRef.current = mobile.matches ? requestedMode : "scroll";
      if (!isPaged()) {
        shell?.classList.remove("isReaderPageEnd");
        content!.classList.remove("isReaderPageDragging");
        content!.style.removeProperty("--reader-page-column-width");
        emitState();
        root.classList.remove("isReaderPagePending");
        if (routeChanged && progressRatio === undefined) window.scrollTo({ top: 0, behavior: "auto" });
        if (progressRatio !== undefined) requestAnimationFrame(() => restoreVerticalProgress(progressRatio));
        return;
      }

      window.scrollTo({ top: 0, behavior: "auto" });
      const storedEntryEdge = sessionStorage.getItem(READER_ENTRY_EDGE_SESSION_KEY);
      const entryEdge = resolveReaderEntryEdge(
        storedEntryEdge,
        `${window.location.pathname}${window.location.search}`,
      );
      if (storedEntryEdge && !entryEdge) sessionStorage.removeItem(READER_ENTRY_EDGE_SESSION_KEY);
      if (entryEdge) entryAnchor = entryEdge;
      const resolvedProgressRatio = progressRatio ?? currentPagedRatio;
      const animateEntry = entryEdge && modeRef.current === "slide" && shell && !matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (animateEntry) {
        shell.classList.add(entryEdge === "end" ? "isReaderRouteEnteringPrevious" : "isReaderRouteEnteringNext");
      }
      afterLayout((settled) => {
        metrics = pageMetrics(content!);
        const targetIndex = resolveReaderEntryPage({
          entryEdge: entryEdge === "start" || entryEdge === "end" ? entryEdge : null,
          progressRatio: resolvedProgressRatio,
          pageCount: metrics.count,
        });
        setLeft(targetIndex * metrics.stride);
        metrics = { ...pageMetrics(content!), index: targetIndex };
        emitState();
        if (!entryEdge) root.classList.remove("isReaderPagePending");
        if (settled && entryEdge) {
          if (
            resolveReaderEntryEdge(
              sessionStorage.getItem(READER_ENTRY_EDGE_SESSION_KEY),
              `${window.location.pathname}${window.location.search}`,
            ) !== entryEdge
          ) return;
          configureColumns();
          metrics = pageMetrics(content!);
          setLeft(entryEdge === "end" ? content!.scrollWidth - content!.clientWidth : 0);
          metrics = pageMetrics(content!);
          emitState();
          if (entryAnchorTimer) window.clearTimeout(entryAnchorTimer);
          entryAnchorTimer = window.setTimeout(() => {
            entryAnchorTimer = 0;
            if (!entryAnchor) return;
            configureColumns();
            metrics = pageMetrics(content!);
            setLeft(entryAnchor === "end" ? content!.scrollWidth - content!.clientWidth : 0);
            metrics = pageMetrics(content!);
            emitState();
            entryAnchor = null;
            sessionStorage.removeItem(READER_ENTRY_EDGE_SESSION_KEY);
          }, 120);
          if (animateEntry && shell) {
            // Establish the off-screen starting position before removing the
            // class; otherwise the browser batches both style changes and
            // skips the transition entirely.
            void shell.offsetWidth;
            enteringFrame = requestAnimationFrame(() => {
              enteringFrame = 0;
              shell.classList.remove("isReaderRouteEnteringPrevious", "isReaderRouteEnteringNext");
            });
          }
          root.classList.remove("isReaderPagePending");
        }
      });
    }

    function handlePageTurnChange(event: Event) {
      const detail = (event as CustomEvent<{ progressRatio?: number }>).detail;
      syncMode(detail?.progressRatio);
    }

    function handleLayoutChange(event: Event) {
      if (!isPaged()) return;
      const detail = (event as CustomEvent<{ progressRatio?: number }>).detail;
      const progressRatio = detail?.progressRatio ?? pagedRatio();
      const anchoredEdge = entryAnchor;
      afterLayout(() => {
        metrics = pageMetrics(content!);
        if (anchoredEdge) {
          setLeft(anchoredEdge === "end" ? content!.scrollWidth - content!.clientWidth : 0);
          metrics = pageMetrics(content!);
          emitState();
          return;
        }
        settleTo(Math.round(progressRatio * Math.max(metrics.count - 1, 0)), false);
      });
    }

    function handleScroll() {
      if (!isPaged() || drag || animationFrame || scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        emitState();
      });
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isPaged() || event.button !== 0) return;
      if (entryAnchor) sessionStorage.removeItem(READER_ENTRY_EDGE_SESSION_KEY);
      entryAnchor = null;
      if (entryAnchorTimer) window.clearTimeout(entryAnchorTimer);
      entryAnchorTimer = 0;
      cancelAnimation();
      metrics = pageMetrics(content!);
      if (metrics.index <= 1 || metrics.index >= metrics.count - 2) prefetchAdjacent(true);
      drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startLeft: content!.scrollLeft,
        startIndex: metrics.index,
        startedAt: performance.now(),
        moved: false,
      };
      content!.setPointerCapture(event.pointerId);
      content!.classList.add("isReaderPageDragging");
    }

    function handlePointerMove(event: PointerEvent) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const distance = drag.startX - event.clientX;
      if (Math.abs(distance) >= 4) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      if (modeRef.current === "slide") setLeft(drag.startLeft + distance);
    }

    function finishDrag(event: PointerEvent, cancelled = false) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const currentDrag = drag;
      drag = null;
      if (content!.hasPointerCapture(event.pointerId)) content!.releasePointerCapture(event.pointerId);
      content!.classList.remove("isReaderPageDragging");
      const distance = currentDrag.startX - event.clientX;
      if (currentDrag.moved) suppressClickUntil = performance.now() + 400;
      const elapsed = Math.max(performance.now() - currentDrag.startedAt, 1);
      const velocity = distance / elapsed;
      const target = cancelled || !currentDrag.moved
        ? currentDrag.startIndex
        : resolveReaderDragTarget({
            startIndex: currentDrag.startIndex,
            distance,
            velocity,
            stride: metrics.stride,
            pageCount: metrics.count,
          });
      if (target < 0 && navigate(previousHref, -1, false)) return;
      if (target >= metrics.count && navigate(nextHref, 1, false)) return;
      settleTo(target, modeRef.current === "slide" && target !== currentDrag.startIndex);
    }

    function handlePagedTap(event: MouseEvent) {
      if (!isPaged() || event.defaultPrevented) return;
      if (performance.now() < suppressClickUntil) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("a, button, input, select, textarea, label") || window.getSelection()?.toString()) return;
      const bounds = content!.getBoundingClientRect();
      const relativeX = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
      if (relativeX > 0.32 && relativeX < 0.68) return;
      event.preventDefault();
      event.stopPropagation();
      turnBy(relativeX <= 0.32 ? -1 : 1);
    }

    function handlePointerCancel(event: PointerEvent) {
      finishDrag(event, true);
    }

    function handlePageRequest(event: Event) {
      const detail = (event as CustomEvent<{ direction?: number; keepChrome?: boolean }>).detail;
      turnBy(detail?.direction === -1 ? -1 : 1, Boolean(detail?.keepChrome));
    }

    function handleViewportChange() {
      const ratio = modeRef.current === "scroll" ? undefined : pagedRatio();
      syncMode(ratio);
    }

    const resizeObserver = new ResizeObserver(() => {
      const renderedWidth = content!.getBoundingClientRect().width;
      if (!isPaged() || (renderedWidth === lastSize.width && content!.clientHeight === lastSize.height)) return;
      const progressRatio = pagedRatio();
      lastSize = { width: renderedWidth, height: content!.clientHeight };
      handleLayoutChange(new CustomEvent(READER_LAYOUT_CHANGE_EVENT, { detail: { progressRatio } }));
    });

    const connection = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    const canPrefetch = (contentBytes: number | null | undefined, force = false) => force
      ? document.visibilityState === "visible" && !connection?.saveData && connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g"
      : shouldPrefetchReaderRoute({
          contentBytes,
          saveData: connection?.saveData,
          effectiveType: connection?.effectiveType,
          visible: document.visibilityState === "visible",
        });
    function prefetchAdjacent(force = false) {
      if (nextHref && canPrefetch(nextContentBytes, force)) router.prefetch(withLocalePath(nextHref, locale));
      if (previousHref && canPrefetch(previousContentBytes, force)) router.prefetch(withLocalePath(previousHref, locale));
    }
    const win = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    const idleTask = typeof win.requestIdleCallback === "function" && typeof win.cancelIdleCallback === "function"
      ? { kind: "idle" as const, handle: win.requestIdleCallback(() => prefetchAdjacent(), { timeout: 500 }) }
      : { kind: "timeout" as const, handle: window.setTimeout(() => prefetchAdjacent(), 250) };
    syncMode();
    resizeObserver.observe(content);
    content.addEventListener("scroll", handleScroll, { passive: true });
    content.addEventListener("pointerdown", handlePointerDown);
    content.addEventListener("pointermove", handlePointerMove);
    content.addEventListener("pointerup", finishDrag);
    content.addEventListener("pointercancel", handlePointerCancel);
    content.addEventListener("click", handlePagedTap);
    window.addEventListener(READER_PAGE_REQUEST_EVENT, handlePageRequest);
    window.addEventListener(READER_PAGE_STATE_REQUEST_EVENT, emitState);
    window.addEventListener(READER_PAGE_TURN_CHANGE_EVENT, handlePageTurnChange);
    window.addEventListener(READER_LAYOUT_CHANGE_EVENT, handleLayoutChange);
    mobile.addEventListener("change", handleViewportChange);
    return () => {
      if (layoutFrame) cancelAnimationFrame(layoutFrame);
      if (settleFrame) cancelAnimationFrame(settleFrame);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      if (routeFrame) cancelAnimationFrame(routeFrame);
      if (enteringFrame) cancelAnimationFrame(enteringFrame);
      if (entryAnchorTimer) window.clearTimeout(entryAnchorTimer);
      cancelAnimation();
      resizeObserver.disconnect();
      content.removeEventListener("scroll", handleScroll);
      content.removeEventListener("pointerdown", handlePointerDown);
      content.removeEventListener("pointermove", handlePointerMove);
      content.removeEventListener("pointerup", finishDrag);
      content.removeEventListener("pointercancel", handlePointerCancel);
      content.removeEventListener("click", handlePagedTap);
      window.removeEventListener(READER_PAGE_REQUEST_EVENT, handlePageRequest);
      window.removeEventListener(READER_PAGE_STATE_REQUEST_EVENT, emitState);
      window.removeEventListener(READER_PAGE_TURN_CHANGE_EVENT, handlePageTurnChange);
      window.removeEventListener(READER_LAYOUT_CHANGE_EVENT, handleLayoutChange);
      mobile.removeEventListener("change", handleViewportChange);
      content.style.removeProperty("--reader-page-column-width");
      content.classList.remove("isReaderPageDragging");
      shell?.classList.remove("isReaderPageEnd");
      shell?.classList.remove("isReaderRouteLeavingPrevious", "isReaderRouteLeavingNext", "isReaderRouteEnteringPrevious", "isReaderRouteEnteringNext");
      if (idleTask.kind === "idle") win.cancelIdleCallback?.(idleTask.handle);
      else window.clearTimeout(idleTask.handle);
    };
  }, [locale, nextContentBytes, nextHref, pathname, previousContentBytes, previousHref, router]);

  return null;
}
