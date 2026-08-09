"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useState, useTransition } from "react";

export function NovelFavoriteButton({
  novelId,
  initialFavorite,
  showLabel = false,
}: {
  novelId: number;
  initialFavorite: boolean;
  showLabel?: boolean;
}) {
  const [favorite, setFavorite] = useState(initialFavorite);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function toggleFavorite() {
    if (pending) return;
    startTransition(async () => {
      try {
        const response = await fetch(`/api/novels/${novelId}/favorite`, { method: "POST" });
        const result = await response.json() as { ok?: boolean; favorite?: boolean; message?: string };
        if (!response.ok || !result.ok) {
          setMessage(result.message || "操作失败，请稍后重试");
          return;
        }
        setFavorite(Boolean(result.favorite));
        setMessage(result.favorite ? "已收藏" : "已取消收藏");
      } catch {
        setMessage("操作失败，请稍后重试");
      }
    });
  }

  return (
    <span className="novelFavoriteControl">
      <button
        className={favorite ? "isActive" : ""}
        type="button"
        aria-label={favorite ? "取消收藏" : "收藏"}
        aria-pressed={favorite}
        title={favorite ? "取消收藏" : "收藏"}
        disabled={pending}
        onClick={toggleFavorite}
      >
        <Bookmark size={18} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
        {showLabel ? <span>收藏</span> : null}
      </button>
      {message ? <span className="readerActionToast" role="status">{message}</span> : null}
    </span>
  );
}
