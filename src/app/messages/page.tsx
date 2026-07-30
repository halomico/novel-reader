import { Bell, ChevronRight, Mail, MessageSquareText, Plus, Send } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
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
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { uiText, withLocalePath } from "@/lib/locale";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: uiText(await getRequestLocale(), "消息"),
    robots: { index: false, follow: false },
  };
}

type MessagesPageProps = {
  searchParams: Promise<{
    tab?: string;
    thread?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

export default async function MessagesPage({ searchParams }: MessagesPageProps) {
  const locale = await getRequestLocale();
  const tr = (text: string) => uiText(locale, text);
  const user = await getCurrentUser();
  if (!user) redirect(withLocalePath("/login", locale));
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
  const displayAnnouncements = await Promise.all(announcements.map(async (announcement) => ({
    ...announcement,
    title: await localizeText(announcement.title, locale),
  })));

  return (
    <UserWorkspace user={user} active="messages" breadcrumb={tr("消息")}>
      {params.notice ? (
        <DismissibleNotice
          message={await localizeText(params.notice, locale)}
          tone={params.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <section className="messagesPage">
        <header className="messagesHeader">
          <div>
            <h1>{tr("消息")}</h1>
          </div>
          <nav className="messagesTabs" aria-label={tr("消息分类")}>
            <Link className={tab === "announcements" ? "isActive" : ""} href="/messages">
              <Bell size={16} aria-hidden="true" />{tr("公告")}
            </Link>
            <Link className={tab === "station" ? "isActive" : ""} href="/messages?tab=station">
              <Mail size={16} aria-hidden="true" />{tr("站务")}
            </Link>
          </nav>
        </header>

        {tab === "announcements" ? (
          <div className="announcementList">
            {displayAnnouncements.length ? displayAnnouncements.map((announcement) => (
              <Link className="announcementListItem" href={`/announcements/${announcement.id}`} key={announcement.id}>
                <span className={announcement.importance === "important" ? "announcementMarker isImportant" : "announcementMarker"} />
                <span>
                  <strong>{announcement.title}</strong>
                  <small>{announcement.publishedAt ? new Date(announcement.publishedAt).toLocaleDateString(locale === "zh-Hant" ? "zh-TW" : "zh-CN") : ""}</small>
                </span>
                <ChevronRight size={17} aria-hidden="true" />
              </Link>
            )) : <p className="messageEmpty">{tr("暂无公告")}</p>}
          </div>
        ) : selectedThread ? (
          <div className="stationConversation">
            <header>
              <Link href="/messages?tab=station">{tr("站务")}</Link>
              <ChevronRight size={14} aria-hidden="true" />
              <h2>{selectedThread.subject}</h2>
              <span>{tr(selectedThread.status === "open" ? "处理中" : "已结束")}</span>
            </header>
            <div className="stationMessageList">
              {messages.map((message) => (
                <article className={message.authorRole === "admin" ? "isAdmin" : "isUser"} key={message.id}>
                  <header>
                    <strong>{message.authorRole === "admin" ? stationDisplayName : tr("我")}</strong>
                    <time>{new Date(message.createdAt).toLocaleString(locale === "zh-Hant" ? "zh-TW" : "zh-CN", { hour12: false })}</time>
                  </header>
                  <p>{message.body}</p>
                </article>
              ))}
            </div>
            {selectedThread.status === "open" && canMessageStation ? (
              <form className="stationReplyForm" action={replyStationThreadAction}>
                <input name="threadId" type="hidden" value={selectedThread.id} />
                <label>
                  <span className="srOnly">{tr("回复")}</span>
                  <textarea name="body" rows={3} maxLength={4000} placeholder={tr("回复")} required />
                </label>
                <button type="submit" title={tr("发送")} aria-label={tr("发送")}><Send size={16} aria-hidden="true" /></button>
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
                    <small>{tr(thread.status === "open" ? "处理中" : "已结束")} · {new Date(thread.lastMessageAt).toLocaleDateString(locale === "zh-Hant" ? "zh-TW" : "zh-CN")}</small>
                  </span>
                  <ChevronRight size={17} aria-hidden="true" />
                </Link>
              ))}
            </div>
            {canMessageStation ? (
              <details className="stationNewThread">
                <summary><Plus size={16} aria-hidden="true" />{tr("联系")}{stationDisplayName}</summary>
                <form action={createStationThreadAction}>
                  <label><span>{tr("主题")}</span><input name="subject" maxLength={80} required /></label>
                  <label><span>{tr("内容")}</span><textarea name="body" rows={5} maxLength={4000} required /></label>
                  <button type="submit"><MessageSquareText size={15} aria-hidden="true" />{tr("发送")}</button>
                </form>
              </details>
            ) : null}
          </>
        )}
      </section>
    </UserWorkspace>
  );
}
