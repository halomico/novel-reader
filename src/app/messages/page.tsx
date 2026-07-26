import { Bell, ChevronRight, Mail, MessageSquareText, Plus, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { UserWorkspace } from "@/components/UserWorkspace";
import { getNoticeDisplaySeconds, getStationDisplayName } from "@/lib/config";
import {
  getStationThread,
  listStationMessages,
  listUserStationThreads,
  listVisibleAnnouncements,
  markAllUserMessagesRead,
  markStationThreadRead,
} from "@/lib/station";
import { getCurrentUser } from "@/lib/user-auth";
import { hasUserPermission } from "@/lib/user-levels";
import { createStationThreadAction, replyStationThreadAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "消息", robots: { index: false, follow: false } };

type MessagesPageProps = {
  searchParams: Promise<{
    tab?: string;
    thread?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  markAllUserMessagesRead(user.id);
  const params = await searchParams;
  const stationDisplayName = getStationDisplayName();
  const canMessageStation = hasUserPermission(user, "station_message");
  const tab = params.tab === "station" ? "station" : "announcements";
  const announcements = tab === "announcements" ? listVisibleAnnouncements(true) : [];
  const threads = tab === "station" ? listUserStationThreads(user.id) : [];
  const selectedThreadId = Number(params.thread || 0);
  const selectedThread = tab === "station" && selectedThreadId > 0
    ? getStationThread(selectedThreadId, { userId: user.id })
    : null;
  const messages = selectedThread ? listStationMessages(selectedThread.id) : [];
  if (selectedThread) {
    markStationThreadRead(selectedThread.id, "user", user.id);
  }

  return (
    <UserWorkspace user={user} active="messages" breadcrumb="消息">
      {params.notice ? (
        <DismissibleNotice
          message={params.notice}
          tone={params.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <section className="messagesPage">
        <header className="messagesHeader">
          <div>
            <h1>消息</h1>
          </div>
          <nav className="messagesTabs" aria-label="消息分类">
            <Link className={tab === "announcements" ? "isActive" : ""} href="/messages">
              <Bell size={16} aria-hidden="true" />公告
            </Link>
            <Link className={tab === "station" ? "isActive" : ""} href="/messages?tab=station">
              <Mail size={16} aria-hidden="true" />站务
            </Link>
          </nav>
        </header>

        {tab === "announcements" ? (
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
        ) : selectedThread ? (
          <div className="stationConversation">
            <header>
              <Link href="/messages?tab=station">站务</Link>
              <ChevronRight size={14} aria-hidden="true" />
              <h2>{selectedThread.subject}</h2>
              <span>{selectedThread.status === "open" ? "处理中" : "已结束"}</span>
            </header>
            <div className="stationMessageList">
              {messages.map((message) => (
                <article className={message.authorRole === "admin" ? "isAdmin" : "isUser"} key={message.id}>
                  <small>{message.authorRole === "admin" ? stationDisplayName : "我"} · {new Date(message.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
            {selectedThread.status === "open" && canMessageStation ? (
              <form className="stationReplyForm" action={replyStationThreadAction}>
                <input name="threadId" type="hidden" value={selectedThread.id} />
                <label>
                  <span className="srOnly">回复</span>
                  <textarea name="body" rows={3} maxLength={4000} placeholder="补充说明" required />
                </label>
                <button type="submit"><Send size={15} aria-hidden="true" />发送</button>
              </form>
            ) : null}
          </div>
        ) : (
          <>
            <div className="stationThreadList">
              {threads.map((thread) => (
                <Link href={`/messages?tab=station&thread=${thread.id}`} key={thread.id}>
                  <span className={thread.unreadForUser ? "messageUnreadDot" : ""} />
                  <span>
                    <strong>{thread.subject}</strong>
                    <small>{thread.status === "open" ? "处理中" : "已结束"} · {new Date(thread.lastMessageAt).toLocaleDateString("zh-CN")}</small>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              ))}
            </div>
            {canMessageStation ? (
              <details className="stationNewThread">
                <summary><Plus size={16} aria-hidden="true" />联系{stationDisplayName}</summary>
                <form action={createStationThreadAction}>
                  <label><span>主题</span><input name="subject" maxLength={80} required /></label>
                  <label><span>内容</span><textarea name="body" rows={5} maxLength={4000} required /></label>
                  <button type="submit"><MessageSquareText size={15} aria-hidden="true" />发送</button>
                </form>
              </details>
            ) : null}
          </>
        )}
      </section>
    </UserWorkspace>
  );
}
