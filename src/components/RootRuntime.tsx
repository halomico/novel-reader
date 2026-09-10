"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  DEFAULT_LOCALE,
  localeFromPathname,
  LOCALE_COOKIE,
  normalizeLocale,
  TRADITIONAL_LOCALE,
} from "@/lib/locale";
import {
  UMAMI_BEFORE_SEND_HANDLER,
  type UmamiConfig,
} from "@/lib/seo";
import { SiteEntryNotice } from "./SiteEntryNotice";

type EntryNoticePayload = {
  title: string;
  markdown: string;
  version: string;
};

function readDocumentLocale(pathname: string) {
  if (localeFromPathname(pathname) === TRADITIONAL_LOCALE) {
    return TRADITIONAL_LOCALE;
  }
  const cookie = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`));
  return cookie
    ? normalizeLocale(decodeURIComponent(cookie.slice(LOCALE_COOKIE.length + 1)))
    : DEFAULT_LOCALE;
}

function DocumentLocale({ pathname }: { pathname: string }) {
  useEffect(() => {
    const locale = readDocumentLocale(pathname);
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }, [pathname]);

  return null;
}

function EntryNoticeLoader({ adminRoute }: { adminRoute: boolean }) {
  const [notice, setNotice] = useState<EntryNoticePayload | null>(null);

  useEffect(() => {
    if (adminRoute) {
      setNotice(null);
      return;
    }

    const controller = new AbortController();
    void fetch("/api/site-shell", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => response.ok ? response.json() as Promise<{ notice?: EntryNoticePayload | null }> : null)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setNotice(payload?.notice || null);
        }
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [adminRoute]);

  return (
    <SiteEntryNotice
      enabled={Boolean(notice)}
      title={notice?.title || "重要通知"}
      markdown={notice?.markdown || ""}
      version={notice?.version || "announcement-none"}
    />
  );
}

function PublicAnalytics({ adminRoute, config }: { adminRoute: boolean; config: UmamiConfig | null }) {
  if (!config || adminRoute) return null;

  return (
    <>
      <Script id="umami-public-route-filter" strategy="afterInteractive">
        {`window.${UMAMI_BEFORE_SEND_HANDLER}=function(_,payload){var path=window.location.pathname;return path==="/admin"||path.indexOf("/admin/")===0?false:payload;};`}
      </Script>
      <Script
        src={config.scriptUrl}
        data-website-id={config.websiteId}
        data-before-send={UMAMI_BEFORE_SEND_HANDLER}
        strategy="lazyOnload"
      />
      {config.recorderUrl ? (
        <Script src={config.recorderUrl} data-website-id={config.websiteId} strategy="lazyOnload" />
      ) : null}
    </>
  );
}

export function RootRuntime({ umami }: { umami: UmamiConfig | null }) {
  const pathname = usePathname();
  const adminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  return (
    <>
      <DocumentLocale pathname={pathname} />
      <EntryNoticeLoader adminRoute={adminRoute} />
      <PublicAnalytics adminRoute={adminRoute} config={umami} />
    </>
  );
}
