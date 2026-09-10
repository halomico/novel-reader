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
  docked = false,
  children,
}: {
  kind: string;
  title: string;
  meta?: ReactNode;
  onClose: () => void;
  /**
   * A docked panel sits beside the text rather than on top of it: no backdrop, no
   * focus trap, no `aria-modal`. The table of contents is meant to stay open while
   * the reader keeps reading and scrolling, which a modal dialog cannot do.
   */
  docked?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useFocusTrap({
    active: !docked,
    containerRef: panelRef,
    onEscape: onClose,
  });

  const panel = (
    <section
      ref={panelRef}
      className={`readerSidePanel is-${kind}${docked ? " isDocked" : ""}`}
      role={docked ? "region" : "dialog"}
      aria-modal={docked ? undefined : true}
      aria-label={title}
    >
      <header>
        <div><strong>{title}</strong>{meta}</div>
        <button type="button" onClick={onClose} aria-label="关闭"><X size={19} aria-hidden="true" /></button>
      </header>
      {children}
    </section>
  );

  if (docked) return panel;
  return (
    <div className="readerPanelBackdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {panel}
    </div>
  );
}
