"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { jsonMutationRequest } from "@/core/security/browser-mutation";
import { deleteLocalOriginalDraft } from "@/features/original-editor/local-draft";
import { uiText, withLocalePath, type AppLocale } from "@/lib/locale";

export function OriginalDraftDeleteButton({ draftId, title, locale }: { draftId: number; title: string; locale: AppLocale }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const tr = (value: string) => uiText(locale, value);
  async function remove() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/original/drafts/${draftId}`, jsonMutationRequest({ method: "DELETE" }));
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || tr("删除失败，请重试"));
      await deleteLocalOriginalDraft(draftId);
      dialog.current?.close();
      router.replace(withLocalePath(`/original/mine?view=drafts&notice=${encodeURIComponent(tr("草稿已删除"))}&tone=success`, locale), { scroll: false });
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : tr("删除失败，请重试"));
    } finally { setPending(false); }
  }
  return <>
    <button className="originalDraftDelete" type="button" aria-label={`${tr("删除")}：${title || tr("无标题草稿")}`} onClick={() => { setError(""); dialog.current?.showModal(); }}>{tr("删除")}</button>
    <dialog ref={dialog} className="originalDraftDeleteDialog" aria-labelledby={headingId} aria-describedby={descriptionId} onCancel={(event) => { if (pending) event.preventDefault(); }} onClick={(event) => {
      if (event.target !== event.currentTarget || pending) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.current?.close();
    }}>
      <h2 id={headingId}>{tr("删除这篇草稿？")}</h2>
      <p className="originalDraftDeleteTitle">{title || tr("无标题草稿")}</p>
      <p id={descriptionId}>{tr("删除后无法恢复，已发布文章不会受到影响。")}</p>
      {error ? <p role="alert">{error}</p> : null}
      <footer><button type="button" autoFocus disabled={pending} onClick={() => dialog.current?.close()}>{tr("取消")}</button><button type="button" disabled={pending} aria-busy={pending} onClick={() => void remove()}>{tr(pending ? "删除中…" : "删除")}</button></footer>
    </dialog>
  </>;
}
