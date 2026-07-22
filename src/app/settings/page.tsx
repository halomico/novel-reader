import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { getAdminSession } from "@/lib/admin-auth";
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
  const [user, adminSession] = await Promise.all([getCurrentUser(), getAdminSession()]);
  const authenticated = Boolean(user || adminSession);

  return (
    <main className="appShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "阅读设置" }]} />
      <section className="settingsHero">
        <h1>阅读设置</h1>
      </section>
      <SettingsPanel
        previewText={previewText}
        defaultFontSize={defaultFontSize}
        defaultPalette={defaultPalette}
        canConfigureReaderTags={authenticated || (settings.tagLibraryEnabled && settings.guestTagLibraryNavEnabled)}
        canConfigureReaderHotwords={authenticated || (settings.hotwordLinksEnabled && settings.guestHotwordLinksEnabled)}
      />
    </main>
  );
}
