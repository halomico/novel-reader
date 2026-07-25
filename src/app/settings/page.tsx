import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getReaderDefaultFontSize, getSettingsPreviewText } from "@/lib/config";
import { readSiteSettings } from "@/lib/site-settings";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { resolveDefaultPalette } from "@/lib/ui-preferences";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "阅读设置", robots: NO_INDEX_ROBOTS };

export default async function SettingsPage() {
  const settings = readSiteSettings();
  const previewText = getSettingsPreviewText();
  const defaultFontSize = getReaderDefaultFontSize();
  const defaultPalette = resolveDefaultPalette(
    settings.defaultPalette,
    settings.defaultPaletteRandomEnabled,
    settings.defaultPaletteRotationMinutes,
  );
  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  const content = (
    <>
      <section className="settingsHero">
        <h1>阅读设置</h1>
      </section>
      <SettingsPanel
        previewText={previewText}
        defaultFontSize={defaultFontSize}
        defaultLineHeight={settings.readerDefaultLineHeight}
        defaultPalette={defaultPalette}
        defaultTheme={settings.adminTheme}
        defaultReaderTagsMode={settings.readerDefaultTagsMode}
        canConfigureReaderTags={authenticated || (settings.tagLibraryEnabled && settings.guestTagLibraryNavEnabled)}
        canConfigureReaderHotwords={authenticated || (settings.hotwordLinksEnabled && settings.guestHotwordLinksEnabled)}
      />
    </>
  );

  if (user) {
    return (
      <UserWorkspace user={user} active="settings" breadcrumb="阅读设置">
        {content}
      </UserWorkspace>
    );
  }

  return (
    <main className="appShell">
      <SiteHeader currentUser={null} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "阅读设置" }]} />
      {content}
    </main>
  );
}
