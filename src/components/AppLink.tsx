"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  type ComponentProps,
  type FocusEvent,
  type PointerEvent,
} from "react";
import { useLinkNavigationProgress } from "@/components/NavigationProgress";
import { localeFromPathname, withLocalePath } from "@/lib/locale";
import { PREFETCH_HOVER_DELAY_MS, tabPrefetchBudget } from "@/lib/prefetch-budget";

export type PrefetchPolicy = "default" | "intent" | "never";

type AppLinkProps = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & {
  href: string;
  prefetch?: boolean;
  prefetchPolicy?: PrefetchPolicy;
};

type NetworkInformation = {
  effectiveType?: string;
  saveData?: boolean;
};

function canPrefetch(): boolean {
  if (typeof window === "undefined" || document.visibilityState !== "visible") return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
}

/**
 * Localized application link. Intent links prefetch when a pointer rests on them or a
 * mouse button goes down, never on touch (a scroll starts with one), and always within
 * the tab's shared prefetch budget.
 */
export function AppLink({
  href,
  prefetch,
  prefetchPolicy = prefetch === false ? "never" : prefetch === true ? "default" : "intent",
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onClick,
  onNavigate,
  ...props
}: AppLinkProps) {
  const pathname = usePathname();
  const router = useRouter();
  const progress = useLinkNavigationProgress(onClick, onNavigate);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localizedHref = withLocalePath(href, localeFromPathname(pathname));

  function clearPrefetchTimer() {
    if (!prefetchTimerRef.current) return;
    clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
  }

  function doPrefetch(intent: "hover" | "press") {
    if (prefetchPolicy === "never" || !canPrefetch()) return;
    if (!tabPrefetchBudget().tryAcquire(localizedHref, intent)) return;
    try {
      router.prefetch(localizedHref);
    } catch {
      // A failed prefetch only loses the head start; the click still fetches the page.
    }
  }

  function schedulePrefetch() {
    clearPrefetchTimer();
    if (prefetchPolicy === "never" || !canPrefetch()) return;
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null;
      doPrefetch("hover");
    }, PREFETCH_HOVER_DELAY_MS);
  }

  useEffect(() => clearPrefetchTimer, []);

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    if (!event.defaultPrevented && event.pointerType !== "touch") schedulePrefetch();
  }

  function handlePointerDown(event: PointerEvent<HTMLAnchorElement>) {
    onPointerDown?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.pointerType === "touch") return;
    clearPrefetchTimer();
    doPrefetch("press");
  }

  function handlePointerLeave(event: PointerEvent<HTMLAnchorElement>) {
    onPointerLeave?.(event);
    clearPrefetchTimer();
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    if (!event.defaultPrevented) schedulePrefetch();
  }

  function handleBlur(event: FocusEvent<HTMLAnchorElement>) {
    onBlur?.(event);
    clearPrefetchTimer();
  }

  return (
    <Link
      href={localizedHref}
      {...props}
      // Intent links are prefetched only after user intent. Enabling Next's
      // viewport prefetch here would eagerly fetch every card on large lists.
      prefetch={prefetch ?? (prefetchPolicy === "default")}
      onPointerEnter={handlePointerEnter}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onClick={progress.onClick}
      onNavigate={progress.onNavigate}
    />
  );
}
