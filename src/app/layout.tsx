import type { Metadata } from "next";
import { ThemeScript } from "@/components/ThemeScript";
import { getReaderDefaultFontSize, getSiteTitle } from "@/lib/config";
import { getSiteIconHref } from "@/lib/site-icon";
import { readSiteSettings } from "@/lib/site-settings";
import "./globals.css";

export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  const siteIconHref = getSiteIconHref();
  return {
    title: getSiteTitle(),
    description: "简洁高质量的中文小说阅读网站",
    icons: siteIconHref ? { icon: siteIconHref, shortcut: siteIconHref } : undefined,
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = readSiteSettings();
  const defaultFontSize = getReaderDefaultFontSize();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <ThemeScript defaultTheme={settings.adminTheme} defaultFontSize={defaultFontSize} defaultPalette={settings.defaultPalette} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
