"use client";

import { Flag, X } from "lucide-react";
import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SelectControl } from "./SelectControl";
import { useFocusTrap } from "@/lib/focus-trap";
import type { ContentReportCategory } from "@/domains/activity/postgres-reports";

export type ContentReportOption = { value: ContentReportCategory; label: string };
type ReportTarget = { novelId: number } | { mediaId: number } | { originalArticleId: number };

export function ContentReportButton({
  target,
  title,
  dialogTitle,
  options,
  defaultCategory,
  variant = "icon",
}: {
  target: ReportTarget;
  title: string;
  dialogTitle: string;
  options: ContentReportOption[];
  defaultCategory: ContentReportCategory;
  variant?: "icon" | "text" | "responsive";
}) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ContentReportCategory>(defaultCategory);
  const [details, setDetails] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();

  function close() {
    setOpen(false);
    setCategory(defaultCategory);
    setDetails("");
    setMessage("");
    setSubmitting(false);
  }

  const formRef = useRef<HTMLFormElement>(null);

  useFocusTrap({
    active: open,
    containerRef: formRef,
    initialFocusRef: closeButtonRef,
    onEscape: close,
  });

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 2_600);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
        headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
        body: JSON.stringify({ ...target, category, details }),
      });
      const data = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !data.ok) {
        setMessage(data.message || "提交失败，请稍后重试");
        return;
      }
      close();
      setNotice("反馈已提交");
    } catch {
      setMessage("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="readerReportAction">
      <button type="button" aria-label={`反馈 ${title}`} title="反馈" onClick={() => setOpen(true)}>
        {variant !== "text" ? <Flag size={16} aria-hidden="true" /> : null}
        {variant !== "icon" ? <span>反馈</span> : null}
      </button>
      {notice ? <span className="readerActionToast" role="status">{notice}</span> : null}
      {open ? createPortal(
        <div className="readerReportBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
          <form ref={formRef} className="readerReportDialog" role="dialog" aria-modal="true" aria-labelledby={dialogId} onSubmit={submit}>
            <header>
              <div><h2 id={dialogId}>{dialogTitle}</h2><p>{title}</p></div>
              <button ref={closeButtonRef} type="button" onClick={close} aria-label="关闭" title="关闭"><X size={18} aria-hidden="true" /></button>
            </header>
            <label>
              <span>问题类型</span>
              <SelectControl value={category} onChange={(event) => setCategory(event.target.value as ContentReportCategory)}>
                {options.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
              </SelectControl>
            </label>
            <label>
              <span>补充说明{category === "other" ? "" : "（可选）"}</span>
              <textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={200} required={category === "other"} rows={4} />
            </label>
            {message ? <p className="readerReportError" role="alert">{message}</p> : null}
            <footer><button type="submit" disabled={submitting}>提交</button></footer>
          </form>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
