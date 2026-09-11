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

const INTENT_PREFETCH_DELAY_MS = 30;
const INTENT_PREFETCH_TTL_MS = 60_000;

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
 * Localized application link with bounded intent prefetch.
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
  const prefetchedHrefRef = useRef<string | null>(null);
  const prefetchedAtRef = useRef(0);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localizedHref = withLocalePath(href, localeFromPathname(pathname));

  function clearPrefetchTimer() {
    if (!prefetchTimerRef.current) return;
    clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
  }

  function doPrefetch() {
    if (prefetchPolicy === "never" || isPrefetched() || !canPrefetch()) return;
    prefetchedHrefRef.current = localizedHref;
    prefetchedAtRef.current = Date.now();
    try {
      router.prefetch(localizedHref);
    } catch {
      prefetchedHrefRef.current = null;
    }
  }

  function isPrefetched() {
    return prefetchedHrefRef.current === localizedHref && Date.now() - prefetchedAtRef.current < INTENT_PREFETCH_TTL_MS;
  }

  function schedulePrefetch() {
    clearPrefetchTimer();
    if (prefetchPolicy === "never" || isPrefetched() || !canPrefetch()) return;
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null;
      doPrefetch();
    }, INTENT_PREFETCH_DELAY_MS);
  }

  useEffect(() => clearPrefetchTimer, []);

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    if (!event.defaultPrevented) schedulePrefetch();
  }

  function handlePointerDown(event: PointerEvent<HTMLAnchorElement>) {
    onPointerDown?.(event);
    if (!event.defaultPrevented && event.button === 0) doPrefetch();
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
