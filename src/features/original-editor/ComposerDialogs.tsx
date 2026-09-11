"use client";

import { useEffect, useRef } from "react";
import styles from "./OriginalComposer.module.css";

/** Opens and closes a native modal dialog from a boolean. */
export function useModalDialog(open: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return dialogRef;
}

export function ConflictDialog({
  open,
  onUseServer,
  onKeepLocal,
}: {
  open: boolean;
  onUseServer: () => void;
  onKeepLocal: () => void;
}) {
  const dialogRef = useModalDialog(open);
  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={(event) => event.preventDefault()}>
      <h2>检测到其他页面的更新</h2>
      <p>服务器上已有更新版本。请选择保留当前内容为新版本，或载入服务器版本。</p>
      <div className={styles.dialogActions}>
        <button type="button" onClick={onUseServer}>使用服务器版本</button>
        <button type="button" className={styles.primaryButton} onClick={onKeepLocal}>保留当前内容</button>
      </div>
    </dialog>
  );
}

/** Leaving with edits that were never saved: save them, drop them, or keep writing. */
export function UnsavedChangesDialog({
  open,
  pending,
  newDraft,
  onCancel,
  onDiscard,
  onSave,
}: {
  open: boolean;
  pending: boolean;
  newDraft: boolean;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  const dialogRef = useModalDialog(open);
  return (
    <dialog ref={dialogRef} className={styles.dialog} onCancel={(event) => { event.preventDefault(); if (!pending) onCancel(); }}>
      <h2>{newDraft ? "保存为草稿？" : "保存修改？"}</h2>
      <p>{newDraft ? "这篇文章还没有保存，保存后可以在“草稿”中继续编辑。" : "离开前还有未保存的修改。"}</p>
      <div className={styles.dialogActions}>
        <button type="button" disabled={pending} onClick={onDiscard}>不保存</button>
        <button type="button" disabled={pending} onClick={onCancel}>继续编辑</button>
        <button type="button" disabled={pending} className={styles.primaryButton} onClick={onSave}>{pending ? "保存中…" : "保存"}</button>
      </div>
    </dialog>
  );
}
