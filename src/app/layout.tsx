import type { Metadata } from "next";
import Script from "next/script";
import { Suspense } from "react";
import { BfcacheHeaderScript } from "@/components/BfcacheHeaderScript";
import { DefaultPaletteRotation } from "@/components/DefaultPaletteRotation";
import { LocalePreferenceSync } from "@/components/LocalePreferenceSync";
import { NavigationProgress } from "@/components/NavigationProgress";
import { RouteScrollState } from "@/components/RouteScrollState";
import { SiteEntryNotice } from "@/components/SiteEntryNotice";
import { ThemeScript } from "@/components/ThemeScript";
import { getReaderDefaultFontSize, getSiteTitle } from "@/lib/config";
import { getRequestLocale, localizeTexts } from "@/lib/locale-server";
import { getSiteUrl, getUmamiConfig } from "@/lib/seo";
import { getSiteIconHref } from "@/lib/site-icon";
import { readSiteSettings } from "@/lib/site-settings";
import { getEntryDrawerAnnouncement } from "@/lib/station";
import { getCurrentUser } from "@/lib/user-auth";
import { resolveDefaultPalette } from "@/lib/ui-preferences";
import "./globals.css";
import "./ui-final.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const siteIconHref = getSiteIconHref();
  const locale = await getRequestLocale();
  const [siteTitle, description] = await localizeTexts(
    [getSiteTitle(), "简洁、快速的中文小说在线阅读站。"] as const,
    locale,
  );
  return {
    metadataBase: new URL(getSiteUrl()),
    title: {
      default: siteTitle,
      template: `%s | ${siteTitle}`,
    },
    description,
    icons: siteIconHref ? { icon: siteIconHref, shortcut: siteIconHref } : undefined,
    openGraph: {
      type: "website",
      locale: locale === "zh-Hant" ? "zh_TW" : "zh_CN",
      siteName: siteTitle,
      title: siteTitle,
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = readSiteSettings();
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  const entryAnnouncement = getEntryDrawerAnnouncement(Boolean(user));
  const defaultFontSize = getReaderDefaultFontSize();
  const umami = getUmamiConfig();
  const defaultPalette = resolveDefaultPalette(
    settings.defaultPalette,
    settings.defaultPaletteRandomEnabled,
    settings.defaultPaletteRotationMinutes,
  );

  return (
    <html lang={locale} data-locale={locale} suppressHydrationWarning>
      <head>
        <ThemeScript
          defaultTheme={settings.adminTheme}
          defaultFontSize={defaultFontSize}
          defaultLineHeight={settings.readerDefaultLineHeight}
          defaultPalette={defaultPalette}
          defaultReaderTagsMode={settings.readerDefaultTagsMode}
        />
        <BfcacheHeaderScript />
      </head>
      <body>
        <LocalePreferenceSync />
        <Suspense fallback={null}><NavigationProgress /></Suspense>
        <Suspense fallback={null}><RouteScrollState /></Suspense>
        {settings.defaultPaletteRandomEnabled ? (
          <DefaultPaletteRotation
            fallback={settings.defaultPalette}
            enabled
            intervalMinutes={settings.defaultPaletteRotationMinutes}
          />
        ) : null}
        {umami ? (
          <Script src={umami.scriptUrl} data-website-id={umami.websiteId} strategy="lazyOnload" />
        ) : null}
        {umami?.recorderUrl ? (
          <Script src={umami.recorderUrl} data-website-id={umami.websiteId} strategy="lazyOnload" />
        ) : null}
        {children}
        <SiteEntryNotice
          enabled={Boolean(entryAnnouncement)}
          title={entryAnnouncement?.title || "重要通知"}
          markdown={entryAnnouncement?.body || ""}
          version={entryAnnouncement?.entryVersion || `announcement-${entryAnnouncement?.id || "none"}`}
        />
      </body>
    </html>
  );
}
