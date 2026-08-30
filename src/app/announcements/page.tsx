import { Bell, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
import { notFound } from "next/navigation";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { PageContextBar } from "@/components/PageContextBar";
import { SiteHeader } from "@/components/SiteHeader";
import { canAccessHomeAnnouncementCard, canSeeHomePortalContentEntry } from "@/lib/config";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { listVisibleAnnouncements } from "@/lib/station";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: uiText(locale, "公告"),
    description: uiText(locale, "站点公告与更新。"),
    alternates: {
      canonical: withLocalePath("/announcements", locale),
      languages: languageAlternates("/announcements"),
    },
    robots: canAccessHomeAnnouncementCard(false) ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

export default async function AnnouncementsPage() {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessHomeAnnouncementCard(Boolean(user))) {
    if (!user && canSeeHomePortalContentEntry("announcement", false)) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "公告")} returnTo="/announcements" />;
    }
    notFound();
  }
  const announcements = listVisibleAnnouncements(Boolean(user));
  const displayAnnouncements = await Promise.all(announcements.map(async (announcement) => ({
    ...announcement,
    title: await localizeText(announcement.title, locale),
  })));
  const [homeLabel, announcementLabel] = await localizeTexts(["首页", "公告"] as const, locale);
  return (
    <main className="appShell announcementShell">
      <SiteHeader currentUser={user} />
      <PageContextBar items={[{ label: homeLabel, href: "/" }, { label: announcementLabel }]} />
      <section className="messagesPage publicAnnouncementsPage">
        <header className="messagesHeader"><h1><Bell size={20} aria-hidden="true" />{announcementLabel}</h1></header>
        <div className="announcementList">
          {displayAnnouncements.length ? displayAnnouncements.map((announcement) => (
            <Link className="announcementListItem" href={`/announcements/${announcement.id}`} key={announcement.id}>
              <span className={announcement.importance === "important" ? "announcementMarker isImportant" : "announcementMarker"} />
              <span>
                <strong>{announcement.title}</strong>
                <small>{announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString(locale === "zh-Hant" ? "zh-TW" : "zh-CN") : ""}</small>
              </span>
              <ChevronRight size={17} aria-hidden="true" />
            </Link>
          )) : <p className="messageEmpty">{uiText(locale, "暂无公告")}</p>}
        </div>
      </section>
    </main>
  );
}
