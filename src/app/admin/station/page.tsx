import { Bell, Check, ChevronRight, Flag, Mail, Plus, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AdminSelect } from "@/components/AdminSelect";
import { LocalDateTime } from "@/components/LocalDateTime";
import { Pagination } from "@/components/Pagination";
import { getStationDisplayName } from "@/lib/config";
import { listContentReports, type ContentReportCategory } from "@/lib/reports";
import {
  getStationThread,
  getVisibleAnnouncement,
  listAdminAnnouncements,
  listAdminStationThreads,
  listStationMessages,
  markStationThreadRead,
} from "@/lib/station";
import { AdminFrame } from "../AdminFrame";
import { updateContentReportStatusAction } from "../actions";
import {
  deleteAnnouncementAction,
  replyStationThreadAdminAction,
  saveAnnouncementAction,
  setStationThreadStatusAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

type StationAdminPageProps = {
  searchParams: Promise<{
    view?: string;
    thread?: string;
    edit?: string;
    status?: string;
    page?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

const REPORT_CATEGORY_LABELS: Record<ContentReportCategory, string> = {
  title_error: "标题有误",
  tag_error: "标签有误",
  hotword_error: "热词有误",
  spam: "垃圾页面",
  other: "其他",
};

function localDateTime(value: string | null): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  const date = new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

export default async function AdminStationPage({ searchParams }: StationAdminPageProps) {
  const params = await searchParams;
  const view = params.view === "announcements"
    ? "announcements"
    : params.view === "reports"
      ? "reports"
      : "inbox";
  const stationDisplayName = getStationDisplayName();
  const threads = view === "inbox" ? listAdminStationThreads() : [];
  const selectedThread = view === "inbox" ? getStationThread(Number(params.thread || 0), { admin: true }) : null;
  const messages = selectedThread ? listStationMessages(selectedThread.id) : [];
  if (selectedThread) markStationThreadRead(selectedThread.id, "admin");
  const announcements = view === "announcements" ? listAdminAnnouncements() : [];
  const selectedAnnouncement = view === "announcements"
    ? getVisibleAnnouncement(Number(params.edit || 0), { admin: true })
    : null;
  const reports = view === "reports"
    ? listContentReports({ status: params.status, page: Number(params.page || 1), pageSize: 30 })
    : null;
  const threadReturnPath = selectedThread ? `/admin/station?thread=${selectedThread.id}` : "/admin/station";
  const announcementReturnPath = selectedAnnouncement
    ? `/admin/station?view=announcements&edit=${selectedAnnouncement.id}`
    : "/admin/station?view=announcements";
  const reportReturnParams = new URLSearchParams({ view: "reports" });
  if (reports && reports.status !== "open") reportReturnParams.set("status", reports.status);
  if (reports && reports.page > 1) reportReturnParams.set("page", String(reports.page));
  const reportReturnPath = `/admin/station?${reportReturnParams.toString()}`;

  return (
    <AdminFrame active="station" notice={params.notice} tone={params.tone}>
      <article className="adminPanel stationAdminPanel">
        <header className="adminPanelHeader stationAdminHeader">
          <nav className="messagesTabs" aria-label="站务分类">
            <Link className={view === "inbox" ? "isActive" : ""} href="/admin/station">
              <Mail size={16} aria-hidden="true" />留言
            </Link>
            <Link className={view === "reports" ? "isActive" : ""} href="/admin/station?view=reports">
              <Flag size={16} aria-hidden="true" />举报
            </Link>
            <Link className={view === "announcements" ? "isActive" : ""} href="/admin/station?view=announcements">
              <Bell size={16} aria-hidden="true" />公告
            </Link>
          </nav>
        </header>

        {view === "inbox" ? (
          <div className="adminStationLayout">
            <nav className="adminStationThreadList" aria-label="站务留言">
              {threads.length ? threads.map((thread) => (
                <Link className={selectedThread?.id === thread.id ? "isActive" : ""} href={`/admin/station?thread=${thread.id}`} key={thread.id}>
                  <span className={thread.unreadForAdmin ? "messageUnreadDot" : ""} />
                  <span>
                    <strong>{thread.subject}</strong>
                    <small>{thread.displayName} · {thread.status === "open" ? "处理中" : "已结束"}</small>
                  </span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              )) : <p className="adminInlineEmpty">暂无留言</p>}
            </nav>
            <section className="adminStationConversation">
              {selectedThread ? (
                <>
                  <header>
                    <div>
                      <h2>{selectedThread.subject}</h2>
                      <small>{selectedThread.displayName}（{selectedThread.username}）</small>
                    </div>
                    <form action={setStationThreadStatusAction}>
                      <input name="threadId" type="hidden" value={selectedThread.id} />
                      <input name="returnPath" type="hidden" value={threadReturnPath} />
                      <input name="status" type="hidden" value={selectedThread.status === "open" ? "closed" : "open"} />
                      <button className="adminSecondaryButton" type="submit">
                        {selectedThread.status === "open" ? "结束" : "重新打开"}
                      </button>
                    </form>
                  </header>
                  <div className="stationMessageList">
                    {messages.map((message) => (
                      <article className={message.authorRole === "admin" ? "isAdmin" : "isUser"} key={message.id}>
                        <small>{message.authorRole === "admin" ? stationDisplayName : selectedThread.displayName} · {new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
                        <p>{message.body}</p>
                      </article>
                    ))}
                  </div>
                  {selectedThread.status === "open" ? (
                    <form className="stationReplyForm" action={replyStationThreadAdminAction}>
                      <input name="threadId" type="hidden" value={selectedThread.id} />
                      <input name="returnPath" type="hidden" value={threadReturnPath} />
                      <label><span className="srOnly">回复</span><textarea name="body" rows={3} maxLength={4000} required /></label>
                      <button type="submit"><Send size={15} aria-hidden="true" />回复</button>
                    </form>
                  ) : null}
                </>
              ) : <p className="adminInlineEmpty">选择一条留言查看详情</p>}
            </section>
          </div>
        ) : view === "reports" && reports ? (
          <section className="adminStationReports">
            <nav className="adminReportFilters" aria-label="举报状态">
              {([
                ["open", "待处理"],
                ["resolved", "已处理"],
                ["all", "全部"],
              ] as const).map(([value, label]) => (
                <Link
                  className={reports.status === value ? "isActive" : ""}
                  href={value === "open"
                    ? "/admin/station?view=reports"
                    : `/admin/station?view=reports&status=${value}`}
                  key={value}
                >
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
                  {reports.reports.length ? reports.reports.map((report) => (
                    <tr key={report.id}>
                      <td><Link href={`/books/${report.novelId}`}>{report.novelTitle}</Link></td>
                      <td>
                        <span className="adminReportIssue">
                          <strong>{REPORT_CATEGORY_LABELS[report.category]}</strong>
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
                          <input name="returnPath" type="hidden" value={reportReturnPath} />
                          <button
                            className={report.status === "open" ? "adminReportStatusButton" : "adminReportStatusButton isResolved"}
                            type="submit"
                          >
                            {report.status === "open"
                              ? <Check size={14} aria-hidden="true" />
                              : <RotateCcw size={14} aria-hidden="true" />}
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
              page={reports.page}
              totalPages={reports.totalPages}
              query=""
              basePath="/admin/station"
              extraParams={{
                view: "reports",
                status: reports.status === "open" ? undefined : reports.status,
              }}
            />
          </section>
        ) : (
          <div className="adminAnnouncementLayout">
            <nav className="adminAnnouncementList" aria-label="公告列表">
              <Link className={!selectedAnnouncement ? "isActive" : ""} href="/admin/station?view=announcements">
                <Plus size={16} aria-hidden="true" /><span><strong>新建公告</strong></span>
              </Link>
              {announcements.map((announcement) => (
                <Link
                  className={selectedAnnouncement?.id === announcement.id ? "isActive" : ""}
                  href={`/admin/station?view=announcements&edit=${announcement.id}`}
                  key={announcement.id}
                >
                  <span className={announcement.importance === "important" ? "announcementMarker isImportant" : "announcementMarker"} />
                  <span>
                    <strong>{announcement.title}</strong>
                    <small>{announcement.status === "published" ? "已发布" : announcement.status === "draft" ? "草稿" : "已归档"}</small>
                  </span>
                </Link>
              ))}
            </nav>
            <form className="adminAnnouncementEditor" action={saveAnnouncementAction}>
              {selectedAnnouncement ? <input name="id" type="hidden" value={selectedAnnouncement.id} /> : null}
              <input name="returnPath" type="hidden" value={announcementReturnPath} />
              <label><span>标题</span><input name="title" maxLength={80} defaultValue={selectedAnnouncement?.title || ""} required /></label>
              <label><span>内容</span><textarea name="body" rows={9} maxLength={4000} defaultValue={selectedAnnouncement?.body || ""} required /></label>
              <div className="adminAnnouncementFields">
                <label>
                  <span>可见范围</span>
                  <AdminSelect name="audience" defaultValue={selectedAnnouncement?.audience || "public"}>
                    <option value="public">公开</option>
                    <option value="member">登录可见</option>
                  </AdminSelect>
                </label>
                <label>
                  <span>级别</span>
                  <AdminSelect name="importance" defaultValue={selectedAnnouncement?.importance || "normal"}>
                    <option value="normal">普通</option>
                    <option value="important">重要</option>
                  </AdminSelect>
                </label>
                <label>
                  <span>状态</span>
                  <AdminSelect name="status" defaultValue={selectedAnnouncement?.status || "draft"}>
                    <option value="draft">草稿</option>
                    <option value="published">发布</option>
                    <option value="archived">归档</option>
                  </AdminSelect>
                </label>
                <label><span>发布时间</span><input name="publishedAt" type="datetime-local" defaultValue={localDateTime(selectedAnnouncement?.publishedAt || null)} /></label>
                <label><span>到期时间</span><input name="expiresAt" type="datetime-local" defaultValue={localDateTime(selectedAnnouncement?.expiresAt || null)} /></label>
              </div>
              <div className="adminTagEditorActions">
                <button type="submit"><Save size={15} aria-hidden="true" />保存</button>
                {selectedAnnouncement ? (
                  <button className="adminDangerButton" type="submit" formAction={deleteAnnouncementAction} formNoValidate>
                    <Trash2 size={15} aria-hidden="true" />删除
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        )}
      </article>
    </AdminFrame>
  );
}
