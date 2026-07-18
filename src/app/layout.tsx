import type { Metadata } from "next";
import Script from "next/script";
import { ThemeScript } from "@/components/ThemeScript";
import { getReaderDefaultFontSize, getSiteTitle } from "@/lib/config";
import { getSiteUrl, getUmamiConfig } from "@/lib/seo";
import { getSiteIconHref } from "@/lib/site-icon";
import { readSiteSettings } from "@/lib/site-settings";
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

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <ThemeScript defaultTheme={settings.adminTheme} defaultFontSize={defaultFontSize} defaultPalette={settings.defaultPalette} />
      </head>
      <body>
        {umami ? (
          <Script src={umami.scriptUrl} data-website-id={umami.websiteId} strategy="afterInteractive" />
        ) : null}
        {children}
      </body>
    </html>
  );
}
