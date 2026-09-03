import { LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { OriginalEditorForm } from "@/components/OriginalEditorForm";
import { SiteHeader } from "@/components/SiteHeader";
import { getCookieToSodaRate, getNoticeDisplaySeconds, getOriginalPublishingSettings, isOriginalChannelEnabled } from "@/lib/config";
import { getRequestLocale } from "@/lib/locale-server";
import { canPublishOriginal, listOriginalTags } from "@/lib/original";
import { getCurrentUser } from "@/lib/user-auth";
import { uiText } from "@/lib/locale";
import { createOriginalArticleAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "发布文章", robots: { index: false, follow: false } };

export default async function NewOriginalPage({ searchParams }: { searchParams: Promise<{ notice?: string; tone?: "success" | "warning" | "error" }> }) {
  if (!isOriginalChannelEnabled()) redirect("/original");
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!user) redirect("/login?returnTo=%2Foriginal%2Fnew");
  const params = await searchParams;
  const settings = getOriginalPublishingSettings();
  const availableTags = listOriginalTags({ publishedOnly: true });
  const allowed = canPublishOriginal(user);
  const equivalentSoda = Math.floor(user.sodaBalance + user.cookieBalance * getCookieToSodaRate());
  const levelReady = user.trustLevel >= settings.minLevel;
  const balanceReady = equivalentSoda >= settings.minSoda;
  const missingSoda = Math.max(settings.minSoda - equivalentSoda, 0);
  const publishRequirement = `${tr("余额达到")} ${settings.minSoda} ${tr("苏打")} ${tr("或")} ${tr("等级达到")} Lv.${settings.minLevel}`;
  return (
    <main className="appShell originalShell originalEditorShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: tr("首页"), href: "/" }, { label: tr("原创"), href: "/original" }, { label: tr("发布文章") }]} />
      {params.notice ? <DismissibleNotice message={params.notice} tone={params.tone} variant="search" displaySeconds={getNoticeDisplaySeconds()} /> : null}
      <section className="originalEditorPage">
        {!allowed ? (
          <>
            <header className="originalEditorHeader"><h1>{tr("发布文章")}</h1></header>
            <section className="originalGate originalPublishGate">
              <header><LockKeyhole size={20} aria-hidden="true" /><strong>{tr("发布权限未解锁")}</strong></header>
              <div className="originalPublishStatus"><span>Lv.{user.trustLevel}</span><span>{equivalentSoda} {tr("苏打")}</span></div>
              <p>{publishRequirement}。{missingSoda > 0 && !levelReady ? `${tr("还差")} ${missingSoda} ${tr("苏打")}` : levelReady || balanceReady ? tr("已满足发布条件") : ""}</p>
            </section>
          </>
        ) : (
          <OriginalEditorForm locale={locale} action={createOriginalArticleAction} settings={settings} mode="create" heading={tr("发布文章")} closeHref="/original" availableTags={availableTags} />
        )}
      </section>
    </main>
  );
}
