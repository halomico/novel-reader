import type { Metadata } from "next";
import { ThemeScript } from "@/components/ThemeScript";
import { getSiteTitle } from "@/lib/config";
import { readSiteSettings } from "@/lib/site-settings";
import "./globals.css";

export const metadata: Metadata = {
  title: getSiteTitle(),
  description: "简洁高质量的中文小说阅读网站",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = readSiteSettings();

  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <ThemeScript defaultTheme={settings.adminTheme} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
