"use client";

import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { useFocusTrap } from "@/lib/focus-trap";
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
  const panelRef = useRef<HTMLElement>(null);

  useFocusTrap({
    active: true,
    containerRef: panelRef,
    onEscape: onClose,
  });

  // Novels and original articles share one drawer: it opens beside the tool rail and
  // never covers it, and a press outside the drawer closes it.
  return (
    <div className="readerPanelBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section
        ref={panelRef}
        className={`readerSidePanel is-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <div><strong>{title}</strong>{meta}</div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={19} aria-hidden="true" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}
