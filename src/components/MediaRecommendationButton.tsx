"use client";

import { CupSoda } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

export function MediaRecommendationButton({
  mediaId,
  initialRecommended,
}: {
  mediaId: number;
  initialRecommended: boolean;
}) {
  const [recommended, setRecommended] = useState(initialRecommended);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2_600);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function recommend() {
    if (recommended || pending) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/media/${mediaId}/recommendation`, { method: "POST" });
        const result = await response.json() as {
          ok?: boolean;
          recommended?: boolean;
          alreadyRecommended?: boolean;
          message?: string;
        };
        if (!response.ok || !result.ok) {
          setMessage(result.message || "推荐失败，请稍后重试");
          return;
        }
        setRecommended(Boolean(result.recommended));
        setMessage(result.alreadyRecommended ? "已经推荐过了" : "已用 1 苏打推荐");
      } catch {
        setMessage("推荐失败，请稍后重试");
      }
    });
  }

  return (
    <span className="novelRecommendationControl">
      <button
        className={recommended ? "isActive" : ""}
        type="button"
        aria-label={recommended ? "已推荐" : "使用 1 苏打推荐"}
        aria-pressed={recommended}
        title={recommended ? "已推荐" : "使用 1 苏打推荐"}
        disabled={pending || recommended}
        onClick={recommend}
      >
        <CupSoda size={18} aria-hidden="true" />
      </button>
      {message ? <span className="readerActionToast" role="status">{message}</span> : null}
    </span>
  );
}
