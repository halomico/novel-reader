import { Bell } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import { getVisibleAnnouncement, markAnnouncementRead } from "@/lib/station";
import { NO_INDEX_ROBOTS } from "@/lib/seo";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

type AnnouncementPageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: AnnouncementPageProps): Promise<Metadata> {
  const user = await getCurrentUser();
  const announcement = getVisibleAnnouncement(Number((await params).id), { authenticated: Boolean(user) });
  if (!announcement) return { title: "公告不存在", robots: NO_INDEX_ROBOTS };
  const canonical = `/announcements/${announcement.id}`;
  const description = announcement.body.replace(/\s+/gu, " ").slice(0, 120);
  return {
    title: announcement.title,
    description,
    alternates: announcement.audience === "public" ? { canonical } : undefined,
    robots: announcement.audience === "public" ? { index: true, follow: true } : NO_INDEX_ROBOTS,
  };
}

export default async function AnnouncementPage({ params }: AnnouncementPageProps) {
  const user = await getCurrentUser();
  const announcement = getVisibleAnnouncement(Number((await params).id), { authenticated: Boolean(user) });
  if (!announcement) notFound();
  if (user) markAnnouncementRead(user.id, announcement.id);

  return (
    <main className="appShell messagesShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "公告", href: "/announcements" }, { label: announcement.title }]} />
      <article className="announcementDetail">
        <header>
          <Bell size={19} aria-hidden="true" />
          <div>
            <h1>{announcement.title}</h1>
            <time dateTime={announcement.publishedAt || undefined}>
              {announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString("zh-CN") : ""}
            </time>
          </div>
        </header>
        <div className="announcementBody">{announcement.body}</div>
      </article>
    </main>
  );
}
