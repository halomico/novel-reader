import { Bell, ChevronLeft, ChevronRight, Link2, Mail, MessageSquareText, Send, Unlink } from "lucide-react";
import type { Metadata } from "next";
import Link from "@/components/LocalizedLink";
import { redirect } from "next/navigation";
import { DismissibleNotice } from "@/components/DismissibleNotice";
import { UserStationConversation } from "@/components/UserStationConversation";
import { StationNewThreadDialog } from "@/components/StationNewThreadDialog";
import { UserWorkspace } from "@/components/UserWorkspace";
import { WorkspacePage, WorkspacePageHeader, WorkspacePrimaryTabs } from "@/components/WorkspacePageChrome";
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
import { getTelegramUserLink } from "@/lib/telegram-links";
import { isTelegramUserLinkAvailable } from "@/lib/telegram-config";
import { unlinkTelegramAction } from "./actions";
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
  const telegramAvailable = isTelegramUserLinkAvailable();
  const telegramLink = telegramAvailable ? getTelegramUserLink(user.id) : null;
  if (selectedThread) {
    markStationThreadRead(selectedThread.id, "user", user.id);
  }
  const displayAnnouncements = await Promise.all(announcements.map(async (announcement) => ({
    ...announcement,
    title: await localizeText(announcement.title, locale),
  })));

  return (
    <UserWorkspace user={user} active="messages" breadcrumb={tr("消息")} mobileImmersive={Boolean(selectedThread)}>
      {params.notice ? (
        <DismissibleNotice
          message={await localizeText(params.notice, locale)}
          tone={params.tone}
          variant="search"
          displaySeconds={getNoticeDisplaySeconds()}
        />
      ) : null}
      <WorkspacePage className={selectedThread ? "messagesPage hasConversation" : "messagesPage"}>
        <WorkspacePageHeader className="messagesHeader" icon={MessageSquareText} title={tr("消息")} />
        <WorkspacePrimaryTabs
          className="messagesPageTabs"
          label={tr("消息分类")}
          items={[
            { href: "/messages", label: tr("公告"), icon: Bell, active: tab === "announcements" },
            { href: "/messages?tab=station", label: tr("站务"), icon: Mail, active: tab === "station" },
          ]}
        />

        {tab === "station" && telegramAvailable ? (
          <div className="telegramLinkPanel">
            <Send size={18} aria-hidden="true" />
            <span>
              <strong>Telegram</strong>
              <small>{telegramLink ? (telegramLink.username ? `@${telegramLink.username}` : tr("已连接")) : tr("同步站务回复")}</small>
            </span>
            {telegramLink ? (
              <form action={unlinkTelegramAction}>
                <button type="submit" title={tr("断开")} aria-label={tr("断开")}><Unlink size={15} aria-hidden="true" /></button>
              </form>
            ) : (
              <a href="/api/telegram/link" target="_blank" rel="noreferrer">
                <Link2 size={15} aria-hidden="true" />{tr("连接")}
              </a>
            )}
          </div>
        ) : null}

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
        ) : (
          <section className={selectedThread ? "stationChatWorkspace hasSelection" : "stationChatWorkspace"}>
            <aside className="stationChatSidebar">
              <header>
                <strong>{tr("对话")}</strong>
                {canMessageStation ? (
                  <StationNewThreadDialog locale={locale} stationDisplayName={stationDisplayName} />
                ) : null}
              </header>
              <nav className="stationThreadList" aria-label={tr("站务对话")}>
                {threads.map((thread) => (
                  <Link className={selectedThread?.id === thread.id ? "isActive" : ""} href={`/messages?tab=station&thread=${thread.id}`} key={thread.id}>
                    <span className="stationThreadAvatar">
                      <MessageSquareText size={15} aria-hidden="true" />
                      {thread.unreadForUser ? <i className="messageUnreadDot" /> : null}
                    </span>
                    <span>
                      <strong>{thread.subject}</strong>
                      <small>{tr(thread.status === "open" ? "处理中" : "已结束")} · {new Date(thread.lastMessageAt).toLocaleDateString(locale === "zh-Hant" ? "zh-TW" : "zh-CN")}</small>
                    </span>
                    <ChevronRight size={15} aria-hidden="true" />
                  </Link>
                ))}
                {!threads.length ? <p className="messageEmpty">{tr("暂无对话")}</p> : null}
              </nav>
            </aside>
            {selectedThread ? (
              <div className="stationConversation">
                <header>
                  <Link className="stationChatBack" href="/messages?tab=station" aria-label={tr("返回站务列表")}>
                    <span className="stationChatBackIcon"><ChevronLeft size={25} strokeWidth={1.8} aria-hidden="true" /></span>
                  </Link>
                  <span className="stationConversationHeading">
                    <h2>{selectedThread.subject}</h2>
                    <small>{tr(selectedThread.status === "open" ? "处理中" : "已结束")}</small>
                  </span>
                  <span className="stationChatHeaderSpacer" aria-hidden="true" />
                </header>
                <UserStationConversation
                  threadId={selectedThread.id}
                  initialMessages={messages}
                  initialStatus={selectedThread.status}
                  stationDisplayName={stationDisplayName}
                  selfLabel={tr("我")}
                  replyLabel={tr("回复")}
                  placeholder={tr("输入消息…")}
                  sendLabel={tr("发送")}
                  closedLabel={tr("对话已结束")}
                />
              </div>
            ) : (
              <div className="stationChatEmpty">
                <MessageSquareText size={24} aria-hidden="true" />
                <strong>{threads.length ? tr("选择一条对话") : tr("暂无站务对话")}</strong>
                <small>{canMessageStation ? tr("从左侧选择或发起新对话") : tr("当前等级暂不可发起站务对话")}</small>
              </div>
            )}
          </section>
        )}
      </WorkspacePage>
    </UserWorkspace>
  );
}
