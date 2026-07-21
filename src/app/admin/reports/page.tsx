import { Check, Flag, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Pagination } from "@/components/Pagination";
import { listContentReports, type ContentReportCategory } from "@/lib/reports";
import { updateContentReportStatusAction } from "../actions";
import { AdminFrame } from "../AdminFrame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

const CATEGORY_LABELS: Record<ContentReportCategory, string> = {
  tag_error: "标签有误",
  hotword_error: "热词有误",
  spam: "垃圾页面",
  other: "其他",
};

type AdminReportsPageProps = {
  searchParams: Promise<{
    status?: string;
    page?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function AdminReportsPage({ searchParams }: AdminReportsPageProps) {
  const params = await searchParams;
  const result = listContentReports({ status: params.status, page: Number(params.page || 1), pageSize: 30 });
  const returnParams = new URLSearchParams();
  if (result.status !== "open") returnParams.set("status", result.status);
  if (result.page > 1) returnParams.set("page", String(result.page));
  const returnPath = `/admin/reports${returnParams.size ? `?${returnParams.toString()}` : ""}`;

  return (
    <AdminFrame active="reports" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminReportsPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>内容举报</h2>
            <p>查看并处理用户提交的文本质量问题。</p>
          </div>
          <Flag size={20} aria-hidden="true" />
        </div>

        <nav className="adminReportFilters" aria-label="举报状态">
          {([
            ["open", "待处理"],
            ["resolved", "已处理"],
            ["all", "全部"],
          ] as const).map(([value, label]) => (
            <Link className={result.status === value ? "isActive" : ""} href={value === "open" ? "/admin/reports" : `/admin/reports?status=${value}`} key={value}>
              {label}
            </Link>
          ))}
        </nav>

        <div className="adminTableWrap">
          <table className="adminTable adminReportsTable">
            <thead>
              <tr>
                <th>小说</th>
                <th>问题</th>
                <th>提交用户</th>
                <th>时间</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {result.reports.length ? result.reports.map((report) => (
                <tr key={report.id}>
                  <td><Link href={`/books/${report.novelId}`}>{report.novelTitle}</Link></td>
                  <td>
                    <span className="adminReportIssue">
                      <strong>{CATEGORY_LABELS[report.category]}</strong>
                      <small>{report.details || "未补充说明"}</small>
                    </span>
                  </td>
                  <td>
                    <span className="adminUserMeta">
                      <Link href={`/admin/users/${report.userId}`}>{report.userDisplayName}</Link>
                      <small>@{report.username}</small>
                    </span>
                  </td>
                  <td><LocalDateTime value={report.createdAt} /></td>
                  <td>
                    <form action={updateContentReportStatusAction}>
                      <input name="reportId" type="hidden" value={report.id} />
                      <input name="status" type="hidden" value={report.status === "open" ? "resolved" : "open"} />
                      <input name="returnPath" type="hidden" value={returnPath} />
                      <button className={report.status === "open" ? "adminReportStatusButton" : "adminReportStatusButton isResolved"} type="submit">
                        {report.status === "open" ? <Check size={14} aria-hidden="true" /> : <RotateCcw size={14} aria-hidden="true" />}
                        {report.status === "open" ? "处理" : "重开"}
                      </button>
                    </form>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={5}>暂无举报记录。</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          query=""
          basePath="/admin/reports"
          extraParams={{ status: result.status === "open" ? undefined : result.status }}
        />
      </article>
    </AdminFrame>
  );
}
