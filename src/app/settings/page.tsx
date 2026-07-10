import { BackButton } from "@/components/BackButton";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { getReaderDefaultFontSize, getSettingsPreviewText } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const previewText = getSettingsPreviewText();
  const defaultFontSize = getReaderDefaultFontSize();

  return (
    <main className="appShell">
      <SiteHeader />
      <section className="settingsHero">
        <BackButton />
        <h1>设置</h1>
      </section>
      <SettingsPanel previewText={previewText} defaultFontSize={defaultFontSize} />
    </main>
  );
}
