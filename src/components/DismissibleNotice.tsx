"use client";

import { useEffect, useState } from "react";

type NoticeTone = "success" | "warning" | "error";
type NoticeVariant = "admin" | "search";

function toneClass(tone: NoticeTone) {
  if (tone === "error") {
    return "isError";
  }
  if (tone === "warning") {
    return "isWarning";
  }
  return "isSuccess";
}

export function DismissibleNotice({
  message,
  tone = "success",
  variant,
  displaySeconds,
  stayVisibleAfterBlur,
}: {
  message: string;
  tone?: NoticeTone;
  variant: NoticeVariant;
  displaySeconds: number;
  stayVisibleAfterBlur: boolean;
}) {
  const [visible, setVisible] = useState(Boolean(message));
  const baseClass = variant === "admin" ? "adminNotice" : "searchNotice";

  useEffect(() => {
    setVisible(Boolean(message));
  }, [message]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    function clearTimer() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function hideAfterDelay() {
      clearTimer();
      if (displaySeconds > 0) {
        timer = setTimeout(() => setVisible(false), displaySeconds * 1000);
      } else {
        setVisible(false);
      }
    }

    if (displaySeconds > 0) {
      timer = setTimeout(() => setVisible(false), displaySeconds * 1000);
    }

    function hideOnBlur() {
      if (!stayVisibleAfterBlur) {
        hideAfterDelay();
      }
    }

    window.addEventListener("blur", hideOnBlur);
    return () => {
      clearTimer();
      window.removeEventListener("blur", hideOnBlur);
    };
  }, [displaySeconds, stayVisibleAfterBlur, visible, message]);

  if (!visible || !message) {
    return null;
  }

  return (
    <p className={`${baseClass} ${toneClass(tone)}`} role="status">
      {message}
    </p>
  );
}
