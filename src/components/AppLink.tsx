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
import { localeFromPathname, withLocalePath } from "@/lib/locale";

const INTENT_PREFETCH_DELAY_MS = 100;

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
  if (document.visibilityState !== "visible") return false;
  const connection = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (connection?.saveData) return false;
  return connection?.effectiveType !== "slow-2g" && connection?.effectiveType !== "2g";
}

/**
 * Localized application link with one explicit prefetch policy. Intent mode is
 * conservative by default: it waits for sustained mouse/keyboard intent and
 * never starts a large route fetch from touchstart.
 */
export function AppLink({
  href,
  prefetch,
  prefetchPolicy = prefetch === false ? "never" : prefetch === true ? "default" : "intent",
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  ...props
}: AppLinkProps) {
  const pathname = usePathname();
  const router = useRouter();
  const prefetchedHrefRef = useRef<string | null>(null);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localizedHref = withLocalePath(href, localeFromPathname(pathname));

  function clearPrefetchTimer() {
    if (!prefetchTimerRef.current) return;
    clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = null;
  }

  function schedulePrefetch() {
    clearPrefetchTimer();
    if (prefetchPolicy !== "intent" || prefetchedHrefRef.current === localizedHref || !canPrefetch()) return;
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null;
      if (!canPrefetch()) return;
      prefetchedHrefRef.current = localizedHref;
      router.prefetch(localizedHref);
    }, INTENT_PREFETCH_DELAY_MS);
  }

  useEffect(() => clearPrefetchTimer, []);

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    if (!event.defaultPrevented && event.pointerType !== "touch") schedulePrefetch();
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
      prefetch={prefetchPolicy === "default"}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );
}
