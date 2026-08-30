"use client";

import { Plus, Send, X } from "lucide-react";
import { useRef } from "react";
import { createStationThreadAction } from "@/app/messages/actions";
import { uiText, type AppLocale } from "@/lib/locale";

export function StationNewThreadDialog({
  locale,
  stationDisplayName,
}: {
  locale: AppLocale;
  stationDisplayName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tr = (text: string) => uiText(locale, text);

  function closeDialog() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        className="stationNewThreadButton"
        type="button"
        aria-label={`${tr("联系")}${stationDisplayName}`}
        title={`${tr("联系")}${stationDisplayName}`}
        onClick={() => dialogRef.current?.showModal()}
      >
        <Plus size={17} aria-hidden="true" />
        <span>{tr("新对话")}</span>
      </button>
      <dialog
        className="stationNewThreadDialog"
        ref={dialogRef}
        aria-labelledby="station-new-thread-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        onClose={(event) => event.currentTarget.querySelector("form")?.reset()}
      >
        <form action={createStationThreadAction}>
          <header>
            <strong id="station-new-thread-title">{tr("新对话")}</strong>
            <button type="button" aria-label={tr("关闭")} title={tr("关闭")} onClick={closeDialog}>
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <label>
            <span>{tr("主题")}</span>
            <input name="subject" maxLength={80} autoFocus required />
          </label>
          <label>
            <span>{tr("内容")}</span>
            <textarea name="body" rows={5} required />
          </label>
          <footer>
            <button type="submit"><Send size={15} aria-hidden="true" />{tr("发送")}</button>
          </footer>
        </form>
      </dialog>
    </>
  );
}
