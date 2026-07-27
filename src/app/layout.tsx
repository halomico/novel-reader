import type { Metadata } from "next";
import Script from "next/script";
import { Suspense } from "react";
import { DefaultPaletteRotation } from "@/components/DefaultPaletteRotation";
import { NavigationProgress } from "@/components/NavigationProgress";
import { ThemeScript } from "@/components/ThemeScript";
import { getReaderDefaultFontSize, getSiteTitle } from "@/lib/config";
import { getMediaPublicUrl } from "@/lib/media-storage-config";
import { getSiteUrl, getUmamiConfig } from "@/lib/seo";
import { getSiteIconHref } from "@/lib/site-icon";
import { readSiteSettings } from "@/lib/site-settings";
import { resolveDefaultPalette } from "@/lib/ui-preferences";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const siteIconHref = getSiteIconHref();
  const siteTitle = getSiteTitle();
  const description = "简洁、快速的中文小说在线阅读站。";
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
      locale: "zh_CN",
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = readSiteSettings();
  const defaultFontSize = getReaderDefaultFontSize();
  const umami = getUmamiConfig();
  const mediaPublicUrl = getMediaPublicUrl();
  const defaultPalette = resolveDefaultPalette(
    settings.defaultPalette,
    settings.defaultPaletteRandomEnabled,
    settings.defaultPaletteRotationMinutes,
  );

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {mediaPublicUrl ? <link rel="preconnect" href={mediaPublicUrl} crossOrigin="" /> : null}
        {mediaPublicUrl ? <link rel="dns-prefetch" href={mediaPublicUrl} /> : null}
        <ThemeScript
          defaultTheme={settings.adminTheme}
          defaultFontSize={defaultFontSize}
          defaultLineHeight={settings.readerDefaultLineHeight}
          defaultPalette={defaultPalette}
          defaultReaderTagsMode={settings.readerDefaultTagsMode}
        />
      </head>
      <body>
        <Suspense fallback={null}><NavigationProgress /></Suspense>
        <DefaultPaletteRotation
          fallback={settings.defaultPalette}
          enabled={settings.defaultPaletteRandomEnabled}
          intervalMinutes={settings.defaultPaletteRotationMinutes}
        />
        {umami ? (
          <Script src={umami.scriptUrl} data-website-id={umami.websiteId} strategy="afterInteractive" />
        ) : null}
        {umami?.recorderUrl ? (
          <Script src={umami.recorderUrl} data-website-id={umami.websiteId} strategy="lazyOnload" />
        ) : null}
        {children}
      </body>
    </html>
  );
}
