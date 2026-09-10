"use client";

import { CupSoda } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { jsonMutationRequest } from "@/core/security/browser-mutation";

export function OriginalTipButton({ articleId, initialTipped, showLabel = true }: { articleId: number; initialTipped: boolean; showLabel?: boolean }) {
  const [notice, setNotice] = useState("");
  const [tipped, setTipped] = useState(initialTipped);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setTipped(initialTipped);
    setNotice("");
  }, [articleId, initialTipped]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function tip() {
    if (pending || tipped) return;
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/original/${articleId}/tip`,
          jsonMutationRequest({ method: "POST" }),
        );
        const result = await response.json() as { ok?: boolean; message?: string; tipped?: boolean };
        if (response.ok && result.ok) {
          setTipped(true);
          setNotice("已打赏作者 1 苏打");
        } else {
          if (result.tipped) setTipped(true);
          setNotice(result.message || "打赏失败，请稍后重试");
        }
      } catch {
        setNotice("打赏失败，请稍后重试");
      }
    });
  }

  return (
    <span className="originalTipControl">
      <button
        className={`${pending ? "isPending" : ""}${tipped ? " isTipped" : ""}`.trim()}
        type="button"
        disabled={pending || tipped}
        aria-busy={pending}
        aria-pressed={tipped}
        onClick={tip}
        aria-label={tipped ? "已打赏" : "打赏作者 1 苏打"}
        title={tipped ? "已打赏" : "打赏作者 1 苏打"}
      >
        <CupSoda size={18} aria-hidden="true" />{showLabel ? <span>{tipped ? "已打赏" : "打赏"}</span> : null}
      </button>
      {notice ? <span className="readerActionToast" role="status">{notice}</span> : null}
    </span>
  );
}
