"use client";

import { CupSoda } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

export function OriginalTipButton({ articleId, showLabel = true }: { articleId: number; showLabel?: boolean }) {
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function tip() {
    if (pending) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/original/${articleId}/tip`, { method: "POST" });
        const result = await response.json() as { ok?: boolean; message?: string };
        setNotice(response.ok && result.ok ? "已打赏作者 1 苏打" : result.message || "打赏失败，请稍后重试");
      } catch {
        setNotice("打赏失败，请稍后重试");
      }
    });
  }

  return (
    <span className="originalTipControl">
      <button
        className={pending ? "isPending" : ""}
        type="button"
        disabled={pending}
        aria-busy={pending}
        onClick={tip}
        aria-label="打赏作者 1 苏打"
        title="打赏作者 1 苏打"
      >
        <CupSoda size={18} aria-hidden="true" />{showLabel ? <span>打赏</span> : null}
      </button>
      {notice ? <span className="readerActionToast" role="status">{notice}</span> : null}
    </span>
  );
}
