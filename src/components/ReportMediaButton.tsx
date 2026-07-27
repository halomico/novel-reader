"use client";

import { Flag, Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { FeedbackMediaKind } from "@/lib/media";
import type { ContentReportCategory } from "@/lib/reports";

const REPORT_OPTIONS: Record<FeedbackMediaKind, Array<{ value: ContentReportCategory; label: string }>> = {
  video: [
    { value: "title_error", label: "标题或简介有误" },
    { value: "playback_error", label: "无法播放或播放异常" },
    { value: "spam", label: "画面或内容问题" },
    { value: "other", label: "其他问题" },
  ],
  audio: [
    { value: "title_error", label: "标题或作者有误" },
    { value: "playback_error", label: "无法播放或播放异常" },
    { value: "spam", label: "音质或内容问题" },
    { value: "other", label: "其他问题" },
  ],
};

export function ReportMediaButton({
  mediaId,
  title,
  kind,
}: {
  mediaId: number;
  title: string;
  kind: FeedbackMediaKind;
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ContentReportCategory>("playback_error");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const kindLabel = kind === "audio" ? "音频" : "视频";

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2_600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function close() {
    setOpen(false);
    setCategory("playback_error");
    setDetails("");
    setMessage("");
    setSubmitting(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (category === "other" && !details.trim()) {
      setMessage("请填写补充说明");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, category, details }),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setMessage(data.message || "提交失败，请稍后重试");
        return;
      }
      close();
      setNotice("举报已提交");
    } catch {
      setMessage("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="readerReportAction">
      <button type="button" aria-label={`举报 ${title}`} title="举报" onClick={() => setOpen(true)}>
        <Flag size={16} aria-hidden="true" />
      </button>
      {notice ? <span className="readerActionToast" role="status">{notice}</span> : null}
      {open ? (
        <div className="readerReportBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <form className="readerReportDialog" role="dialog" aria-modal="true" aria-labelledby="media-report-title" onSubmit={submit}>
            <header>
              <div>
                <h2 id="media-report-title">举报{kindLabel}</h2>
                <p>{title}</p>
              </div>
              <button ref={closeButtonRef} type="button" onClick={close} aria-label="关闭" title="关闭">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <label>
              <span>问题类型</span>
              <select value={category} onChange={(event) => setCategory(event.target.value as ContentReportCategory)}>
                {REPORT_OPTIONS[kind].map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span>补充说明{category === "other" ? "" : "（可选）"}</span>
              <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={200} required={category === "other"} rows={4} />
            </label>
            {message ? <p className="readerReportError" role="alert">{message}</p> : null}
            <footer>
              <button type="submit" disabled={submitting}>
                <Send size={15} aria-hidden="true" />提交
              </button>
            </footer>
          </form>
        </div>
      ) : null}
    </div>
  );
}
