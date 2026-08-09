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
}: {
  message: string;
  tone?: NoticeTone;
  variant: NoticeVariant;
  displaySeconds: number;
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

    if (displaySeconds <= 0) {
      return;
    }

    const timer = setTimeout(() => setVisible(false), displaySeconds * 1000);
    return () => clearTimeout(timer);
  }, [displaySeconds, visible, message]);

  if (!visible || !message) {
    return null;
  }

  return (
    <p className={`${baseClass} ${toneClass(tone)}`} role="status">
      {message}
    </p>
  );
}
