"use client";

import { useEffect } from "react";
import {
  isLocaleAwarePath,
  LOCALE_COOKIE,
  localeFromPathname,
} from "@/lib/locale";

export function LocalePreferenceSync() {
  useEffect(() => {
    const pathname = window.location.pathname;
    if (!isLocaleAwarePath(pathname)) {
      return;
    }
    const locale = localeFromPathname(pathname);
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, []);

  return null;
}
