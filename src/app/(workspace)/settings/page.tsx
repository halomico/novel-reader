import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { cookies } from "next/headers";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import {
  NOVEL_CATALOG_SEARCH_COOKIE,
  normalizeNovelCatalogSearchExpanded,
  resolveDefaultPalette,
} from "@/lib/ui-preferences";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: await localizeText("设置", await getRequestLocale()),
    robots: NO_INDEX_ROBOTS,
  };
}

export default async function SettingsPage() {
  const locale = await getRequestLocale();
  const settings = await readPostgresSiteSettings();
  const defaultFontSize = settings.readerDefaultFontSize;
  const defaultPalette = resolveDefaultPalette(
    settings.defaultPalette,
    settings.defaultPaletteRandomEnabled,
    settings.defaultPaletteRotationMinutes,
  );
  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  const novelCatalogSearchExpanded = normalizeNovelCatalogSearchExpanded(
    (await cookies()).get(NOVEL_CATALOG_SEARCH_COOKIE)?.value,
    settings.novelCatalogSearchExpanded,
  );
  const [settingsTitle, homeLabel] = await localizeTexts(["设置", "首页"] as const, locale);
  const content = (
    <>
      <section className="settingsHero userContentHeader">
        <span><SlidersHorizontal size={19} aria-hidden="true" /><h1>{settingsTitle}</h1></span>
      </section>
      <SettingsPanel
        defaultFontSize={defaultFontSize}
        defaultLineHeight={settings.readerDefaultLineHeight}
        defaultPalette={defaultPalette}
        defaultTheme={settings.adminTheme}
        defaultReaderTagsMode={settings.readerDefaultTagsMode}
        defaultPageTurn={settings.readerDefaultPageTurn}
        canConfigureReaderTags={authenticated || settings.homePortalAccessModes.tags === "browse" || settings.homePortalAccessModes.tags === "public"}
        canConfigureReaderHotwords={authenticated || (settings.hotwordLinksEnabled && settings.guestHotwordLinksEnabled)}
        currentLocale={locale}
        novelCatalogSearchExpanded={novelCatalogSearchExpanded}
      />
    </>
  );

  if (user) {
    return content;
  }

  return (
    <main className="appShell">
      <SiteHeader currentUser={null} />
      <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: settingsTitle }]} />
      {content}
    </main>
  );
}
