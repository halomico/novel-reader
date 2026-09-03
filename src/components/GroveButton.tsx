"use client";

import { Sprout } from "lucide-react";
import { useEffect, useOptimistic, useState, useTransition } from "react";

export function GroveButton({
  contentType,
  contentId,
  initialPlanted,
  showLabel = false,
}: {
  contentType: "novel" | "media" | "original";
  contentId: number;
  initialPlanted: boolean;
  showLabel?: boolean;
}) {
  const [planted, setPlanted] = useState(initialPlanted);
  const [optimisticPlanted, setOptimisticPlanted] = useOptimistic(
    planted,
    (_current, next: boolean) => next,
  );
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function toggleGrove() {
    if (pending) return;
    const nextPlanted = !optimisticPlanted;
    startTransition(async () => {
      setOptimisticPlanted(nextPlanted);
      try {
        const collection = contentType === "novel" ? "novels" : contentType;
        const response = await fetch(`/api/${collection}/${contentId}/grove`, { method: "POST" });
        const result = await response.json() as { ok?: boolean; planted?: boolean; message?: string };
        if (!response.ok || !result.ok) {
          setMessage(result.message || "操作失败，请稍后重试");
          return;
        }
        setPlanted(Boolean(result.planted));
        setMessage(result.planted ? "已种入回响林" : "已移出回响林");
      } catch {
        setMessage("操作失败，请稍后重试");
      }
    });
  }

  return (
    <span className="novelGroveControl">
      <button
        className={optimisticPlanted ? "isActive" : ""}
        type="button"
        aria-label={optimisticPlanted ? "移出回响林" : "种入回响林"}
        aria-pressed={optimisticPlanted}
        aria-busy={pending}
        title={optimisticPlanted ? "移出回响林" : "种入回响林"}
        disabled={pending}
        onClick={toggleGrove}
      >
        <Sprout size={18} fill={optimisticPlanted ? "currentColor" : "none"} aria-hidden="true" />
        {showLabel ? <span>回响林</span> : null}
      </button>
      {message ? <span className="readerActionToast" role="status">{message}</span> : null}
    </span>
  );
}
