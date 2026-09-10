import type { Metadata } from "next";
import { Suspense } from "react";
import { DefaultPaletteRotation } from "@/components/DefaultPaletteRotation";
import { NavigationProgress } from "@/components/NavigationProgress";
import { RootRuntime } from "@/components/RootRuntime";
import { ThemeScript } from "@/components/ThemeScript";
import { DEFAULT_LOCALE } from "@/lib/locale";
import { getRootShellConfiguration } from "@/lib/root-shell";
import "./styles/core.css";

export async function generateMetadata(): Promise<Metadata> {
  const shell = await getRootShellConfiguration();
  return {
    metadataBase: new URL(shell.siteUrl),
    title: {
      default: shell.siteTitle,
      template: `%s | ${shell.siteTitle}`,
    },
    description: shell.description,
    icons: shell.iconHref ? { icon: shell.iconHref, shortcut: shell.iconHref } : undefined,
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: shell.siteTitle,
      title: shell.siteTitle,
      description: shell.description,
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const shell = await getRootShellConfiguration();
  return (
    <html lang={DEFAULT_LOCALE} data-locale={DEFAULT_LOCALE} suppressHydrationWarning>
      <head>
        <ThemeScript
          defaultTheme={shell.theme}
          defaultFontSize={shell.readerDefaultFontSize}
          defaultLineHeight={shell.readerDefaultLineHeight}
          defaultPalette={shell.resolvedDefaultPalette}
          defaultReaderTagsMode={shell.readerDefaultTagsMode}
          defaultPageTurn={shell.readerDefaultPageTurn}
        />
      </head>
      <body>
        <Suspense fallback={null}><NavigationProgress /></Suspense>
        {shell.defaultPaletteRandomEnabled ? (
          <DefaultPaletteRotation
            fallback={shell.defaultPalette}
            enabled
            intervalMinutes={shell.defaultPaletteRotationMinutes}
          />
        ) : null}
        {children}
        <Suspense fallback={null}><RootRuntime umami={shell.umami} /></Suspense>
      </body>
    </html>
  );
}
