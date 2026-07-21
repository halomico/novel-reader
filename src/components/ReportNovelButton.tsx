"use client";

import { Flag, Send, X } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ContentReportCategory } from "@/lib/reports";

const REPORT_OPTIONS: Array<{ value: ContentReportCategory; label: string }> = [
  { value: "tag_error", label: "标签有误" },
  { value: "hotword_error", label: "热词有误" },
  { value: "spam", label: "垃圾页面" },
  { value: "other", label: "其他" },
];

export function ReportNovelButton({ novelId, title }: { novelId: number; title: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ContentReportCategory>("tag_error");
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function close() {
    setOpen(false);
    setCategory("tag_error");
    setDetails("");
    setMessage("");
    setSubmitted(false);
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
        body: JSON.stringify({ novelId, category, details }),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setMessage(data.message || "提交失败，请稍后重试");
        return;
      }
      setSubmitted(true);
      setMessage("已提交");
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
      {open ? (
        <div className="readerReportBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <form className="readerReportDialog" role="dialog" aria-modal="true" aria-labelledby="reader-report-title" onSubmit={submit}>
            <header>
              <div>
                <h2 id="reader-report-title">举报内容</h2>
                <p>{title}</p>
              </div>
              <button ref={closeButtonRef} type="button" onClick={close} aria-label="关闭" title="关闭">
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            {submitted ? (
              <p className="readerReportSuccess" role="status">{message}</p>
            ) : (
              <>
                <label>
                  <span>问题类型</span>
                  <select value={category} onChange={(event) => setCategory(event.target.value as ContentReportCategory)}>
                    {REPORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
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
              </>
            )}
          </form>
        </div>
      ) : null}
    </div>
  );
}
