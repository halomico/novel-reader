import { BackButton } from "@/components/BackButton";
import { SettingsPanel } from "@/components/SettingsPanel";
import { SiteHeader } from "@/components/SiteHeader";
import { getSettingsPreviewText } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const previewText = getSettingsPreviewText();

  return (
    <main className="appShell">
      <SiteHeader />
      <section className="settingsHero">
        <BackButton />
        <h1>设置</h1>
      </section>
      <SettingsPanel previewText={previewText} />
    </main>
  );
}
