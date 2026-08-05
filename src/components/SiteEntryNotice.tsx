"use client";

import { Megaphone, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnnouncementMarkdown } from "./AnnouncementMarkdown";

const DISMISSED_NOTICE_KEY = "novel-site-entry-notice-dismissed";

type SiteEntryNoticeProps = {
  enabled: boolean;
  title: string;
  markdown: string;
  version: string;
};

export function SiteEntryNotice({ enabled, title, markdown, version }: SiteEntryNoticeProps) {
  const pathname = usePathname();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [doNotShowAgain, setDoNotShowAgain] = useState(false);
  const noticeVersion = version || "legacy";

  const closeNotice = useCallback(() => {
    if (doNotShowAgain) {
      try {
        window.localStorage.setItem(DISMISSED_NOTICE_KEY, noticeVersion);
      } catch {
        // Closing remains available even when persistence is unavailable.
      }
    }
    setOpen(false);
  }, [doNotShowAgain, noticeVersion]);

  useEffect(() => {
    if (!enabled || !markdown.trim() || pathname.startsWith("/admin")) {
      setOpen(false);
      return;
    }

    try {
      if (window.localStorage.getItem(DISMISSED_NOTICE_KEY) === noticeVersion) {
        setOpen(false);
        return;
      }
    } catch {
      // The notice still works when private browsing blocks local storage.
    }

    setDoNotShowAgain(false);
    setOpen(true);
  }, [enabled, markdown, noticeVersion, pathname]);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNotice();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeNotice, open]);

  if (!open) return null;

  return (
    <div className="siteEntryNoticeLayer">
      <button
        className="siteEntryNoticeBackdrop"
        type="button"
        tabIndex={-1}
        aria-label="关闭重要通知"
        onClick={closeNotice}
      />
      <section
        className="siteEntryNoticeDrawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-entry-notice-title"
      >
        <span className="siteEntryNoticeHandle" aria-hidden="true" />
        <header>
          <span className="siteEntryNoticeHeadingIcon" aria-hidden="true">
            <Megaphone size={17} />
          </span>
          <strong id="site-entry-notice-title">{title || "重要通知"}</strong>
          <button ref={closeButtonRef} type="button" aria-label="关闭重要通知" onClick={closeNotice}>
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="siteEntryNoticeMarkdown">
          <AnnouncementMarkdown>{markdown}</AnnouncementMarkdown>
        </div>
        <footer>
          <label>
            <input
              type="checkbox"
              checked={doNotShowAgain}
              onChange={(event) => setDoNotShowAgain(event.target.checked)}
            />
            <span>不再显示此条通知</span>
          </label>
          <button className="siteEntryNoticeConfirm" type="button" onClick={closeNotice}>知道了</button>
        </footer>
      </section>
    </div>
  );
}
