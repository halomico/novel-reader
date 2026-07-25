import { Bell, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { SiteHeader } from "@/components/SiteHeader";
import { listVisibleAnnouncements } from "@/lib/station";
import { getCurrentUser } from "@/lib/user-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "公告",
  description: "站点公告与更新。",
  alternates: { canonical: "/announcements" },
};

export default async function AnnouncementsPage() {
  const user = await getCurrentUser();
  const announcements = listVisibleAnnouncements(Boolean(user));
  return (
    <main className="appShell messagesShell">
      <SiteHeader currentUser={user} />
      <Breadcrumbs items={[{ label: "首页", href: "/" }, { label: "公告" }]} />
      <section className="messagesPage publicAnnouncementsPage">
        <header className="messagesHeader"><h1><Bell size={20} aria-hidden="true" />公告</h1></header>
        <div className="announcementList">
          {announcements.length ? announcements.map((announcement) => (
            <Link className="announcementListItem" href={`/announcements/${announcement.id}`} key={announcement.id}>
              <span className={announcement.importance === "important" ? "announcementMarker isImportant" : "announcementMarker"} />
              <span>
                <strong>{announcement.title}</strong>
                <small>{announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString("zh-CN") : ""}</small>
              </span>
              <ChevronRight size={17} aria-hidden="true" />
            </Link>
          )) : <p className="messageEmpty">暂无公告</p>}
        </div>
      </section>
    </main>
  );
}
