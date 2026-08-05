import type { Metadata } from "next";
import Link from "next/link";
import { AdminStationNavigation } from "@/components/AdminStationNavigation";
import { AdminReportList } from "@/components/AdminStationWorkspace";
import { Pagination } from "@/components/Pagination";
import { listContentReports } from "@/lib/reports";
import { AdminFrame } from "../../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type AdminStationReportsPageProps = {
  searchParams: Promise<{ status?: string; page?: string }>;
};

export default async function AdminStationReportsPage({ searchParams }: AdminStationReportsPageProps) {
  const params = await searchParams;
  const result = listContentReports({
    status: params.status,
    page: Number(params.page || 1),
    pageSize: 30,
  });
  return (
    <AdminFrame active="station" breadcrumbs={[{ label: "站务管理", href: "/admin/station" }, { label: "反馈" }]}>
      <div className="adminWorkspace">
        <AdminStationNavigation active="reports" />
        <header className="adminWorkspaceHeader"><div><h1>内容反馈</h1><p>核对并处理用户反馈的内容问题。</p></div></header>
        <nav className="adminCompactTabs" aria-label="反馈状态">
          {([
            ["open", "待处理"],
            ["resolved", "已处理"],
            ["all", "全部"],
          ] as const).map(([value, label]) => (
            <Link
              className={result.status === value ? "isActive" : ""}
              href={value === "open" ? "/admin/station/reports" : `/admin/station/reports?status=${value}`}
              key={value}
            >
              {label}
            </Link>
          ))}
        </nav>
        <AdminReportList reports={result.reports} />
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          query=""
          basePath="/admin/station/reports"
          extraParams={{ status: result.status === "open" ? undefined : result.status }}
        />
      </div>
    </AdminFrame>
  );
}
