"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ComponentProps, type FocusEvent, type PointerEvent } from "react";
import { localeFromPathname, withLocalePath } from "@/lib/locale";
import LocalizedLink from "./LocalizedLink";

const INTENT_PREFETCH_DELAY_MS = 80;

type IntentPrefetchLinkProps = Omit<ComponentProps<typeof LocalizedLink>, "href"> & {
  href: string;
};

export function IntentPrefetchLink({
  href,
  onPointerEnter,
  onPointerLeave,
  onFocus,
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
    if (prefetchedHrefRef.current === localizedHref) return;
    prefetchedHrefRef.current = localizedHref;
    router.prefetch(localizedHref);
  }

  useEffect(() => () => {
    if (prefetchTimerRef.current) clearTimeout(prefetchTimerRef.current);
  }, []);

  function handlePointerEnter(event: PointerEvent<HTMLAnchorElement>) {
    onPointerEnter?.(event);
    if (!event.defaultPrevented && event.pointerType !== "touch") {
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
    if (!event.defaultPrevented) prefetch();
  }

  return (
    <LocalizedLink
      href={href}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      {...props}
    />
  );
}
