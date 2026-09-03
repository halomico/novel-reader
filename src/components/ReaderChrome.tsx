"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { READER_CHROME_SHOW_EVENT, READER_KEEP_CHROME_SESSION_KEY } from "@/lib/reader-layout";

export function keepReaderChromeVisible() {
  sessionStorage.setItem(READER_KEEP_CHROME_SESSION_KEY, "1");
  window.dispatchEvent(new Event(READER_CHROME_SHOW_EVENT));
}

export function ReaderToolRail({ children, label = "阅读工具" }: { children: ReactNode; label?: string }) {
  return <aside className="readerToolRail" aria-label={label}>{children}</aside>;
}

export function ReaderSidePanel({
  kind,
  title,
  meta,
  onClose,
  children,
}: {
  kind: string;
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="readerPanelBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`readerSidePanel is-${kind}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div><strong>{title}</strong>{meta}</div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={19} aria-hidden="true" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
