"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps, type FocusEvent, type PointerEvent, type TouchEvent } from "react";
import { localeFromPathname, withLocalePath } from "@/lib/locale";
import LocalizedLink from "./LocalizedLink";

const INTENT_PREFETCH_DELAY_MS = 80;

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof LocalizedLink>, "href"> & {
  href: string;
  intentPrefetch?: boolean;
};

export function IntentPrefetchLink({
  href,
  intentPrefetch = true,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onTouchStart,
  ...props
}: IntentPrefetchLinkProps) {
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

  function prefetch() {
    clearPrefetchTimer();
    if (!intentPrefetch) return;
    if (prefetchedHrefRef.current === localizedHref) return;
    prefetchedHrefRef.current = localizedHref;
    router.prefetch(localizedHref);
  }

  useEffect(() => () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
  }, []);

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    if (intentPrefetch && !event.defaultPrevented && event.pointerType !== "touch") {
      clearPrefetchTimer();
      prefetchTimerRef.current = setTimeout(prefetch, INTENT_PREFETCH_DELAY_MS);
    }
  }

  function handlePointerLeave(event: PointerEvent<HTMLAnchorElement>) {
    onPointerLeave?.(event);
    clearPrefetchTimer();
  }

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    onFocus?.(event);
    if (intentPrefetch && !event.defaultPrevented) prefetch();
  }

  function handleTouchStart(event: TouchEvent<HTMLAnchorElement>) {
    onTouchStart?.(event);
    if (intentPrefetch && !event.defaultPrevented) prefetch();
  }

  return (
    <LocalizedLink
      href={href}
      {...props}
      prefetch={false}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onTouchStart={handleTouchStart}
    />
  );
}
