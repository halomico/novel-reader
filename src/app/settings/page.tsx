import type { Metadata } from "next";
import { SlidersHorizontal } from "lucide-react";
import { cookies } from "next/headers";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getReaderDefaultFontSize, getSettingsPreviewText } from "@/lib/config";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { readSiteSettings } from "@/lib/site-settings";
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
  const settings = readSiteSettings();
  const previewText = await localizeText(getSettingsPreviewText(), locale);
  const defaultFontSize = getReaderDefaultFontSize();
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
        previewText={previewText}
        defaultFontSize={defaultFontSize}
        defaultLineHeight={settings.readerDefaultLineHeight}
        defaultPalette={defaultPalette}
        defaultTheme={settings.adminTheme}
        defaultReaderTagsMode={settings.readerDefaultTagsMode}
        canConfigureReaderTags={authenticated || settings.homePortalAccessModes.tags === "browse" || settings.homePortalAccessModes.tags === "public"}
        canConfigureReaderHotwords={authenticated || (settings.hotwordLinksEnabled && settings.guestHotwordLinksEnabled)}
        currentLocale={locale}
        novelCatalogSearchExpanded={novelCatalogSearchExpanded}
      />
    </>
  );

  if (user) {
    return (
      <UserWorkspace user={user} active="settings" breadcrumb={settingsTitle}>
        {content}
      </UserWorkspace>
    );
  }

  return (
    <main className="appShell">
      <SiteHeader currentUser={null} />
      <Breadcrumbs items={[{ label: homeLabel, href: "/" }, { label: settingsTitle }]} />
      {content}
    </main>
  );
}
