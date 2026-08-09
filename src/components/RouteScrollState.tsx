"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { stripLocalePath } from "@/lib/locale";

const SCROLL_KEY_PREFIX = "novel-route-scroll:";
const RESTORE_KEY_PREFIX = "novel-route-scroll-restore:";
const RESTORE_REQUEST_TTL_MS = 120_000;

function routeKey(pathname: string, search = ""): string {
  const normalizedPathname = stripLocalePath(pathname) || "/";
  const normalizedSearch = new URLSearchParams(search);
  if (normalizedSearch.get("page") === "1") normalizedSearch.delete("page");
  if (normalizedSearch.get("folderPage") === "1") normalizedSearch.delete("folderPage");
  if (normalizedPathname === "/media" && !normalizedSearch.has("kind")) {
    normalizedSearch.set("kind", "video");
  }
  normalizedSearch.sort();
  const query = normalizedSearch.toString();
  return `${normalizedPathname}${query ? `?${query}` : ""}`;
}

function routeKeyFromHref(href: string): string {
  const url = new URL(href, window.location.origin);
  return routeKey(url.pathname, url.searchParams.toString());
}

export function requestRouteScrollRestore(href: string) {
  try {
    window.sessionStorage.setItem(`${RESTORE_KEY_PREFIX}${routeKeyFromHref(href)}`, String(Date.now()));
  } catch {
    // Navigation remains available when session storage is unavailable.
  }
}

export function RouteScrollState() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentRouteKey = useMemo(
    () => routeKey(pathname, searchParams.toString()),
    [pathname, searchParams],
  );

  useEffect(() => {
    const scrollStorageKey = `${SCROLL_KEY_PREFIX}${currentRouteKey}`;
    const restoreStorageKey = `${RESTORE_KEY_PREFIX}${currentRouteKey}`;
    let saveFrame = 0;
    let restoreFrame = 0;

    const savePosition = () => {
      try {
        window.sessionStorage.setItem(scrollStorageKey, String(window.scrollY));
      } catch {
        // Scroll persistence is optional.
      }
    };

    const onScroll = () => {
      if (saveFrame) return;
      saveFrame = window.requestAnimationFrame(() => {
        saveFrame = 0;
        savePosition();
      });
    };

    try {
      const requestedAt = Number(window.sessionStorage.getItem(restoreStorageKey) || 0);
      window.sessionStorage.removeItem(restoreStorageKey);
      if (requestedAt > 0 && Date.now() - requestedAt <= RESTORE_REQUEST_TTL_MS) {
        const savedTop = Number(window.sessionStorage.getItem(scrollStorageKey));
        if (Number.isFinite(savedTop) && savedTop > 0) {
          const startedAt = window.performance.now();
          const restorePosition = () => {
            window.scrollTo({ top: savedTop, left: 0, behavior: "auto" });
            if (Math.abs(window.scrollY - savedTop) > 2 && window.performance.now() - startedAt < 2_000) {
              restoreFrame = window.requestAnimationFrame(restorePosition);
            }
          };
          restoreFrame = window.requestAnimationFrame(restorePosition);
        }
      }
    } catch {
      // The destination still opens normally when persistence is unavailable.
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", savePosition);
    return () => {
      savePosition();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", savePosition);
      if (saveFrame) window.cancelAnimationFrame(saveFrame);
      if (restoreFrame) window.cancelAnimationFrame(restoreFrame);
    };
  }, [currentRouteKey]);

  return null;
}
