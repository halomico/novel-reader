"use client";

import { Check, ChevronLeft, Plus, RotateCcw, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  deleteContentReportInlineAction,
  deleteStationThreadInlineAction,
  createAdminStationThreadInlineAction,
  replyStationThreadInlineAction,
  setContentReportStatusInlineAction,
  setStationThreadStatusInlineAction,
} from "@/app/admin/station/actions";
import type { ContentReport, ContentReportCategory } from "@/lib/reports";
import type { StationMessage, StationThread } from "@/lib/station";
import { LocalDateTime } from "./LocalDateTime";
import { InlineMutationNotice, useInlineMutation } from "./useInlineMutation";

const REPORT_CATEGORY_LABELS: Record<ContentReportCategory, string> = {
  title_error: "标题有误",
  tag_error: "标签有误",
  hotword_error: "热词有误",
  playback_error: "播放异常",
  spam: "垃圾页面",
  other: "其他",
};

function reportCategoryLabel(report: ContentReport): string {
  if (report.targetType !== "media") return REPORT_CATEGORY_LABELS[report.category];
  if (report.category === "title_error") return report.mediaKind === "audio" ? "音频信息有误" : "视频信息有误";
  if (report.category === "playback_error") return "播放异常";
  if (report.category === "spam") return report.mediaKind === "audio" ? "音质或内容问题" : "画面或内容问题";
  return "其他问题";
}

function resizeReplyTextarea(textarea: HTMLTextAreaElement | null) {
  if (!textarea) return;
  textarea.style.height = "0px";
  const nextHeight = Math.min(textarea.scrollHeight, 120);
  textarea.style.height = `${Math.max(nextHeight, 36)}px`;
  textarea.style.overflowY = textarea.scrollHeight > 120 ? "auto" : "hidden";
}

export function AdminStationComposer({ initialUsername = "" }: { initialUsername?: string }) {
  const router = useRouter();
  const mutation = useInlineMutation();
  const [username, setUsername] = useState(initialUsername);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [open, setOpen] = useState(Boolean(initialUsername));

  useEffect(() => {
    if (initialUsername) {
      setUsername(initialUsername);
      setOpen(true);
    }
  }, [initialUsername]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.run(
      () => createAdminStationThreadInlineAction(username, subject, body),
      (result) => {
        if (!result.ok || !result.data) return;
        setUsername("");
        setSubject("");
        setBody("");
        setOpen(false);
        router.replace(`/admin/station/${result.data.threadId}`, { scroll: false });
        router.refresh();
      },
    );
  }

  return (
    <div className="adminStationComposer">
      <button className="adminStationNewButton" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <Plus size={15} aria-hidden="true" />发起对话
      </button>
      {open ? (
        <section className="adminStationComposePanel" aria-label="发起站务对话">
          <header><strong>新对话</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭" title="关闭"><X size={16} aria-hidden="true" /></button></header>
          <form onSubmit={submit}>
            <div className="adminFieldGrid">
              <label><span>用户名</span><input value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} placeholder="输入完整用户名" required /></label>
              <label><span>主题</span><input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={80} placeholder="简要说明事项" required /></label>
            </div>
            <label><span>消息</span><textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} placeholder="输入消息内容" required /></label>
            <footer>
              <InlineMutationNotice notice={mutation.notice} />
              <button className="adminPrimaryButton" type="submit" disabled={mutation.pending || !username.trim() || !subject.trim() || !body.trim()}>
                <Send size={15} aria-hidden="true" />发送
              </button>
            </footer>
          </form>
        </section>
      ) : null}
    </div>
  );
}

export function AdminStationConversation({
  thread,
  messages: initialMessages,
  stationDisplayName,
  backHref,
}: {
  thread: StationThread;
  messages: StationMessage[];
  stationDisplayName: string;
  backHref?: string;
}) {
  const router = useRouter();
  const mutation = useInlineMutation();
  const [messages, setMessages] = useState(initialMessages);
  const [status, setStatus] = useState(thread.status);
  const [reply, setReply] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const replyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  useEffect(() => {
    setMessages(initialMessages);
    setStatus(thread.status);
  }, [initialMessages, thread.id, thread.status]);

  useEffect(() => {
    resizeReplyTextarea(replyRef.current);
  }, [reply, thread.id]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function syncConversation() {
      try {
        const response = await fetch(`/admin/api/station/threads/${thread.id}`, { cache: "no-store" });
        if (response.ok && active) {
          const payload = await response.json() as {
            messages?: StationMessage[];
            status?: "open" | "closed";
          };
          if (Array.isArray(payload.messages)) {
            setMessages((current) => (
              current.length === payload.messages!.length && current.at(-1)?.id === payload.messages!.at(-1)?.id
                ? current
                : payload.messages!
            ));
          }
          if (payload.status) setStatus(payload.status);
        }
      } catch {
        // Keep the current conversation visible and retry on the next interval.
      } finally {
        if (active) timer = setTimeout(syncConversation, 2_000);
      }
    }

    timer = setTimeout(syncConversation, 2_000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [thread.id]);

  function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.run(
      () => replyStationThreadInlineAction(thread.id, reply),
      (result) => {
        if (!result.ok || !result.data) return;
        setMessages(result.data.messages);
        setReply("");
        replyRef.current?.focus();
      },
    );
  }

  function toggleStatus() {
    const nextStatus = status === "open" ? "closed" : "open";
    mutation.run(
      () => setStationThreadStatusInlineAction(thread.id, nextStatus),
      (result) => {
        if (result.ok && result.data) setStatus(result.data.status);
      },
    );
  }

  function remove() {
    if (!window.confirm(`删除留言“${thread.subject}”？`)) return;
    mutation.run(
      () => deleteStationThreadInlineAction(thread.id),
      (result) => {
        if (result.ok) router.push(backHref || "/admin/station");
      },
    );
  }

  return (
    <section className="adminStationConversation isStandalone">
      <header className={backHref ? "hasBack" : undefined}>
        {backHref ? (
          <Link className="adminStationConversationBack" href={backHref} aria-label="返回站务消息" title="返回站务消息">
            <ChevronLeft size={21} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        ) : null}
        <div className="adminStationConversationTitle">
          <h2>{thread.subject}</h2>
          <small>{thread.displayName} · @{thread.username}</small>
        </div>
        <div className="adminStationThreadActions">
          <span className={status === "open" ? "adminStatusBadge isPending" : "adminStatusBadge"}>
            {status === "open" ? "处理中" : "已结束"}
          </span>
          <button
            className="adminTableIconButton"
            type="button"
            onClick={toggleStatus}
            disabled={mutation.pending}
            title={status === "open" ? "结束留言" : "重新打开"}
            aria-label={status === "open" ? "结束留言" : "重新打开"}
          >
            {status === "open" ? <Check size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
          </button>
          <button className="adminDangerIconButton" type="button" onClick={remove} disabled={mutation.pending} title="删除留言" aria-label="删除留言">
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className={`adminConversationNotice${mutation.notice ? " hasNotice" : ""}`}>
        <InlineMutationNotice notice={mutation.notice} />
      </div>
      <div className="stationMessageList" ref={messageListRef}>
        {messages.map((message) => (
          <article className={message.authorRole === "admin" ? "isAdmin" : "isUser"} key={message.id}>
            <header>
              <strong>{message.authorRole === "admin" ? stationDisplayName : thread.displayName}</strong>
              <LocalDateTime value={message.createdAt} />
            </header>
            <p>{message.body}</p>
          </article>
        ))}
      </div>
      {status === "open" ? (
        <form className="stationReplyForm" onSubmit={submitReply}>
          <label>
            <span className="srOnly">回复</span>
            <textarea
              ref={replyRef}
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={`回复 ${thread.displayName}`}
              required
            />
          </label>
          <button type="submit" disabled={mutation.pending || !reply.trim()} aria-label="发送" title="发送">
            <Send className="stationSendIcon" size={19} strokeWidth={1.8} aria-hidden="true" /><span className="stationSendLabel">发送</span>
          </button>
        </form>
      ) : <p className="adminConversationClosed">这条留言已结束。</p>}
    </section>
  );
}

export function AdminReportList({ reports: initialReports }: { reports: ContentReport[] }) {
  const mutation = useInlineMutation();
  const [reports, setReports] = useState(initialReports);

  useEffect(() => setReports(initialReports), [initialReports]);

  function toggle(report: ContentReport) {
    const status = report.status === "open" ? "resolved" : "open";
    mutation.run(
      () => setContentReportStatusInlineAction(report.id, status),
      (result) => {
        if (!result.ok || !result.data) return;
        setReports((current) => current.map((item) => (
          item.id === report.id ? { ...item, status: result.data!.status } : item
        )));
      },
    );
  }

  function remove(report: ContentReport) {
    if (!window.confirm("删除这条反馈记录？")) return;
    mutation.run(
      () => deleteContentReportInlineAction(report.id),
      (result) => {
        if (result.ok) setReports((current) => current.filter((item) => item.id !== report.id));
      },
    );
  }

  return (
    <>
      <InlineMutationNotice notice={mutation.notice} />
      <div className="adminCommerceTableWrap">
        <table className="adminCommerceTable adminReportsTable">
          <thead><tr><th>内容</th><th>问题</th><th>提交用户</th><th>时间</th><th>状态</th><th><span className="srOnly">操作</span></th></tr></thead>
          <tbody>
            {reports.length ? reports.map((report) => (
              <tr key={report.id}>
                <td>
                  <Link href={report.targetType === "media" ? `/media/${report.targetId}` : `/books/${report.targetId}`}>
                    {report.targetTitle}
                  </Link>
                </td>
                <td><span className="adminReportIssue"><strong>{reportCategoryLabel(report)}</strong><small>{report.details || "未补充说明"}</small></span></td>
                <td><span className="adminUserMeta"><Link href={`/admin/users/${report.userId}`}>{report.userDisplayName}</Link><small>@{report.username}</small></span></td>
                <td><LocalDateTime value={report.createdAt} /></td>
                <td><span className={report.status === "open" ? "adminStatusBadge isPending" : "adminStatusBadge isLive"}>{report.status === "open" ? "待处理" : "已处理"}</span></td>
                <td>
                  <div className="adminCommerceRowActions">
                    <button className="adminTableIconButton" type="button" onClick={() => toggle(report)} disabled={mutation.pending} title={report.status === "open" ? "标记已处理" : "重新打开"} aria-label={report.status === "open" ? "标记已处理" : "重新打开"}>
                      {report.status === "open" ? <Check size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
                    </button>
                    <button className="adminTableIconButton isDanger" type="button" onClick={() => remove(report)} disabled={mutation.pending} title="删除" aria-label="删除反馈">
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            )) : <tr><td colSpan={6} className="adminCommerceEmpty">暂无反馈记录</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
