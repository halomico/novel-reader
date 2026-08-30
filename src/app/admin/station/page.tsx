import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminStationNavigation } from "@/components/AdminStationNavigation";
import { AdminStationComposer } from "@/components/AdminStationWorkspace";
import { listAdminStationThreads } from "@/lib/station";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type StationAdminPageProps = {
  searchParams: Promise<{ view?: string; thread?: string; compose?: string }>;
};

export default async function AdminStationPage({ searchParams }: StationAdminPageProps) {
  const params = await searchParams;
  if (params.view === "reports") redirect("/admin/station/reports");
  if (params.view === "announcements") redirect("/admin/station/announcements");

  const requestedId = Number(params.thread || 0);
  if (Number.isSafeInteger(requestedId) && requestedId > 0) {
    redirect(`/admin/station/${requestedId}`);
  }

  const threads = listAdminStationThreads();

  return (
    <AdminFrame active="station">
      <div className="adminWorkspace adminStationIndex">
        <AdminStationNavigation active="inbox" />
        <header className="adminWorkspaceHeader">
          <div><h1>站务消息</h1></div>
          <AdminStationComposer initialUsername={params.compose || ""} />
        </header>
        <nav className="adminStationThreadList" aria-label="站务留言">
          <header><strong>留言</strong><small>{threads.length}</small></header>
          {threads.map((thread) => (
            <Link href={`/admin/station/${thread.id}`} prefetch={false} key={thread.id}>
              <span className={thread.unreadForAdmin ? "messageUnreadDot" : ""} />
              <span>
                <strong>{thread.subject}</strong>
                <small>{thread.displayName} · {thread.status === "open" ? "处理中" : "已结束"}</small>
              </span>
              <ChevronRight size={15} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        {!threads.length ? (
          <div className="adminStationEmpty">
            <strong>暂无留言</strong>
            <small>用户发起的站务消息会显示在这里。</small>
          </div>
        ) : null}
      </div>
    </AdminFrame>
  );
}
