import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnnouncementMarkdown } from "@/components/AnnouncementMarkdown";
import { ContentEntryGatePage } from "@/components/ContentEntryGatePage";
import { PageContextBar } from "@/components/PageContextBar";
import { SiteHeader } from "@/components/SiteHeader";
import { canAccessHomeAnnouncementCard, canSeeHomePortalContentEntry } from "@/lib/config";
import { getVisibleAnnouncement, markAnnouncementRead } from "@/lib/station";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";
import { getRequestLocale, localizeText, localizeTexts } from "@/lib/locale-server";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";

type AnnouncementPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: AnnouncementPageProps): Promise<Metadata> {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessHomeAnnouncementCard(Boolean(user))) {
    return { title: uiText(locale, "公告"), robots: NO_INDEX_ROBOTS };
  }
  const announcement = getVisibleAnnouncement(Number((await params).id), { authenticated: Boolean(user) });
  if (!announcement) return { title: uiText(locale, "公告不存在"), robots: NO_INDEX_ROBOTS };
  const canonicalPath = `/announcements/${announcement.id}`;
  const canonical = withLocalePath(canonicalPath, locale);
  const title = await localizeText(announcement.title, locale);
  const description = await localizeText(announcement.body.replace(/\s+/gu, " ").slice(0, 120), locale);
  return {
    title,
    description,
    alternates: announcement.audience === "public"
      ? { canonical, languages: languageAlternates(canonicalPath) }
      : undefined,
    robots: announcement.audience === "public" ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

export default async function AnnouncementPage({ params }: AnnouncementPageProps) {
  const locale = await getRequestLocale();
  const user = await getCurrentUser();
  if (!canAccessHomeAnnouncementCard(Boolean(user))) {
    if (!user && canSeeHomePortalContentEntry("announcement", false)) {
      return <ContentEntryGatePage locale={locale} label={uiText(locale, "公告")} returnTo="/announcements" />;
    }
    notFound();
  }
  const announcement = getVisibleAnnouncement(Number((await params).id), { authenticated: Boolean(user) });
  if (!announcement) notFound();
  if (user) markAnnouncementRead(user.id, announcement.id);
  const displayTitle = await localizeText(announcement.title, locale);
  const displayBody = await localizeText(announcement.body, locale);
  const [homeLabel, announcementLabel] = await localizeTexts(["首页", "公告"] as const, locale);

  return (
    <main className="appShell announcementShell">
      <SiteHeader currentUser={user} />
      <PageContextBar items={[
        { label: homeLabel, href: "/" },
        { label: announcementLabel, href: "/announcements" },
        { label: displayTitle },
      ]} />
      <article className="announcementDetail">
        <header className="announcementDetailHeader">
          <h1>{displayTitle}</h1>
          <time dateTime={announcement.publishedAt || undefined}>
            {announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString(locale === "zh-Hant" ? "zh-TW" : "zh-CN") : ""}
          </time>
        </header>
        <div className="announcementBody">
          <AnnouncementMarkdown>{displayBody}</AnnouncementMarkdown>
        </div>
      </article>
    </main>
  );
}
