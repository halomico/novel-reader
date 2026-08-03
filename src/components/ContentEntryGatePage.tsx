import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import { uiText, type AppLocale } from "@/lib/locale";
import { ContentAccessGate } from "./ContentAccessGate";

export function ContentEntryGatePage({
  locale,
  label,
  returnTo,
}: {
  locale: AppLocale;
  label: string;
  returnTo: string;
}) {
  return (
    <main className="appShell contentEntryPage">
      <SiteHeader currentUser={null} />
      <Breadcrumbs items={[{ label: uiText(locale, "首页"), href: "/" }, { label }]} />
      <ContentAccessGate
        returnTo={returnTo}
        title={uiText(locale, `登录后查看${label}`)}
        description={uiText(locale, `${label}已开放入口，登录后即可继续。`)}
        label={uiText(locale, "登录")}
      />
    </main>
  );
}
