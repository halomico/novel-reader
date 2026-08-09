import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminAnnouncementEditor } from "@/components/AdminAnnouncementEditor";
import { AdminStationNavigation } from "@/components/AdminStationNavigation";
import { getVisibleAnnouncement } from "@/lib/station";
import { AdminFrame } from "../../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminEditAnnouncementPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminEditAnnouncementPage({ params }: AdminEditAnnouncementPageProps) {
  const announcement = getVisibleAnnouncement(Number((await params).id), { admin: true });
  if (!announcement) notFound();
  return (
    <AdminFrame
      active="station"
      breadcrumbs={[{ label: "站务管理", href: "/admin/station" }, { label: "公告", href: "/admin/station/announcements" }, { label: announcement.title }]}
    >
      <div className="adminWorkspace">
        <AdminStationNavigation active="announcements" />
        <header className="adminWorkspaceHeader"><div><h1>{announcement.title}</h1><p>编辑公告内容与展示范围。</p></div></header>
        <AdminAnnouncementEditor announcement={announcement} />
      </div>
    </AdminFrame>
  );
}
