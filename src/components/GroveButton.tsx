"use client";

import { Sprout } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

export function GroveButton({
  contentType,
  contentId,
  initialPlanted,
  showLabel = false,
}: {
  contentType: "novel" | "media";
  contentId: number;
  initialPlanted: boolean;
  showLabel?: boolean;
}) {
  const [planted, setPlanted] = useState(initialPlanted);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function toggleGrove() {
    if (pending) return;
    startTransition(async () => {
      try {
        const collection = contentType === "novel" ? "novels" : "media";
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
        className={planted ? "isActive" : ""}
        type="button"
        aria-label={planted ? "移出回响林" : "种入回响林"}
        aria-pressed={planted}
        title={planted ? "移出回响林" : "种入回响林"}
        disabled={pending}
        onClick={toggleGrove}
      >
        <Sprout size={18} fill={planted ? "currentColor" : "none"} aria-hidden="true" />
        {showLabel ? <span>回响林</span> : null}
      </button>
      {message ? <span className="readerActionToast" role="status">{message}</span> : null}
    </span>
  );
}
