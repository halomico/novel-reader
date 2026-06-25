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

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    if (displaySeconds > 0) {
      timers.push(setTimeout(() => setVisible(false), displaySeconds * 1000));
    }

    function hideOnBlur() {
      if (!stayVisibleAfterBlur) {
        setVisible(false);
      }
    }

    window.addEventListener("blur", hideOnBlur);
    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      window.removeEventListener("blur", hideOnBlur);
    };
  }, [displaySeconds, stayVisibleAfterBlur, visible]);

  if (!visible || !message) {
    return null;
  }

  return (
    <p className={`${baseClass} ${toneClass(tone)}`} role="status">
      {message}
    </p>
  );
}
