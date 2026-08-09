import type { Metadata } from "next";
import { AdminAnnouncementEditor } from "@/components/AdminAnnouncementEditor";
import { AdminStationNavigation } from "@/components/AdminStationNavigation";
import { AdminFrame } from "../../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminNewAnnouncementPage({
  searchParams,
}: {
  searchParams: Promise<{ display?: string }>;
}) {
  const query = await searchParams;
  const initialDisplayMode = query.display === "drawer" || query.display === "both" ? query.display : "list";
  return (
    <AdminFrame
      active="station"
      breadcrumbs={[{ label: "站务管理", href: "/admin/station" }, { label: "公告", href: "/admin/station/announcements" }, { label: "发布公告" }]}
    >
      <div className="adminWorkspace">
        <AdminStationNavigation active="announcements" />
        <header className="adminWorkspaceHeader"><div><h1>发布公告</h1><p>填写完成后直接发布，也可以选择暂不展示。</p></div></header>
        <AdminAnnouncementEditor announcement={null} initialDisplayMode={initialDisplayMode} />
      </div>
    </AdminFrame>
  );
}
