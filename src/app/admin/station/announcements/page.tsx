import { Edit3 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminStationNavigation } from "@/components/AdminStationNavigation";
import { LocalDateTime } from "@/components/LocalDateTime";
import { listAdminAnnouncements } from "@/lib/station";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminAnnouncementsPageProps = {
  searchParams: Promise<{
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AdminAnnouncementsPage({ searchParams }: AdminAnnouncementsPageProps) {
  const query = await searchParams;
  const announcements = listAdminAnnouncements(200);
  return (
    <AdminFrame
      active="station"
      notice={query.notice}
      tone={query.tone}
      breadcrumbs={[{ label: "站务管理", href: "/admin/station" }, { label: "公告" }]}
    >
      <div className="adminWorkspace">
        <AdminStationNavigation active="announcements" showCreate />
        <header className="adminWorkspaceHeader"><div><h1>公告</h1><p>管理公开或仅登录用户可见的站点通知。</p></div></header>
        <div className="adminCommerceTableWrap">
          <table className="adminCommerceTable">
            <thead><tr><th>标题</th><th>范围</th><th>级别</th><th>展示</th><th>状态</th><th>发布时间</th><th><span className="srOnly">操作</span></th></tr></thead>
            <tbody>
              {announcements.length ? announcements.map((announcement) => (
                <tr key={announcement.id}>
                  <td><Link className="adminCommerceProductName" href={`/admin/station/announcements/${announcement.id}`}><strong>{announcement.title}</strong></Link></td>
                  <td>{announcement.audience === "public" ? "公开" : "登录可见"}</td>
                  <td>{announcement.importance === "important" ? "重要" : "普通"}</td>
                  <td>{announcement.displayMode === "drawer" ? "进站抽屉" : announcement.displayMode === "both" ? "列表 + 抽屉" : "公告列表"}</td>
                  <td><span className={announcement.status === "published" ? "adminStatusBadge isLive" : "adminStatusBadge"}>{announcement.status === "published" ? "已发布" : "已下线"}</span></td>
                  <td>{announcement.publishedAt ? <LocalDateTime value={announcement.publishedAt} /> : "未设置"}</td>
                  <td>
                    <Link className="adminTableIconButton" href={`/admin/station/announcements/${announcement.id}`} title="编辑" aria-label={`编辑 ${announcement.title}`}>
                      <Edit3 size={15} aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              )) : <tr><td colSpan={7} className="adminCommerceEmpty">暂无公告</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </AdminFrame>
  );
}
