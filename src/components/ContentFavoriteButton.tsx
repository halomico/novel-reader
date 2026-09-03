"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useOptimistic, useState, useTransition } from "react";

type FavoriteCollection = "novels" | "media" | "original";

export function ContentFavoriteButton({
  collection,
  contentId,
  initialFavorite,
  showLabel = false,
}: {
  collection: FavoriteCollection;
  contentId: number;
  initialFavorite: boolean;
  showLabel?: boolean;
}) {
  const [favorite, setFavorite] = useState(initialFavorite);
  const [optimisticFavorite, setOptimisticFavorite] = useOptimistic(
    favorite,
    (_current, next: boolean) => next,
  );
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2_000);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function toggleFavorite() {
    if (pending) return;
    const nextFavorite = !optimisticFavorite;
    startTransition(async () => {
      setOptimisticFavorite(nextFavorite);
      try {
        const response = await fetch(`/api/${collection}/${contentId}/favorite`, { method: "POST" });
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
        className={optimisticFavorite ? "isActive" : ""}
        type="button"
        aria-label={optimisticFavorite ? "取消收藏" : "收藏"}
        aria-pressed={optimisticFavorite}
        aria-busy={pending}
        title={optimisticFavorite ? "取消收藏" : "收藏"}
        disabled={pending}
        onClick={toggleFavorite}
      >
        <Bookmark size={18} fill={optimisticFavorite ? "currentColor" : "none"} aria-hidden="true" />
        {showLabel ? <span>收藏</span> : null}
      </button>
      {message ? <span className="readerActionToast" role="status">{message}</span> : null}
    </span>
  );
}
