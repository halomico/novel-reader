"use client";

import { ShieldBan } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

export function OriginalAuthorBlockButton({
  authorId,
  initialBlocked,
  compact = false,
  returnTo,
}: {
  authorId: number;
  initialBlocked: boolean;
  compact?: boolean;
  returnTo?: string;
}) {
  const [blocked, setBlocked] = useState(initialBlocked);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function toggle() {
    if (pending) return;
    const next = !blocked;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/original/authors/${authorId}/block`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: JSON.stringify({ blocked: next }),
        });
        const result = await response.json() as { ok?: boolean; blocked?: boolean; message?: string };
        if (!response.ok || !result.ok) {
          setNotice(result.message || "操作失败，请稍后重试");
          return;
        }
        setBlocked(Boolean(result.blocked));
        setNotice(result.blocked ? "已屏蔽该作者" : "已取消屏蔽");
        if (result.blocked && returnTo) router.push(returnTo);
        else router.refresh();
      } catch {
        setNotice("操作失败，请稍后重试");
      }
    });
  }

  return (
    <span className={`originalAuthorBlockControl${compact ? " isCompact" : ""}`}>
      <button type="button" disabled={pending} onClick={toggle} aria-label={blocked ? "取消屏蔽作者" : "屏蔽作者"} aria-pressed={blocked} title={blocked ? "取消屏蔽" : "屏蔽作者"}>
        <ShieldBan size={compact ? 14 : 16} aria-hidden="true" /><span>{blocked ? "取消屏蔽" : "屏蔽作者"}</span>
      </button>
      {notice ? <span className="readerActionToast" role="status">{notice}</span> : null}
    </span>
  );
}
