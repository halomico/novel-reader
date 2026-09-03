"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

function clientKey(mode: "new" | "edit", articleSlug?: string): string {
  const key = `novel-reader:original-draft-launch:${mode}:${articleSlug || "new"}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = `draft_${typeof crypto.randomUUID === "function" ? crypto.randomUUID().replace(/-/g, "") : `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
    sessionStorage.setItem(key, value);
    return value;
  } catch {
    return `draft_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

export function OriginalDraftLauncher({
  mode,
  articleSlug,
}: {
  mode: "new" | "edit";
  articleSlug?: string;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch("/api/original/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
          body: JSON.stringify({
            clientKey: clientKey(mode, articleSlug),
            articleSlug: mode === "edit" ? articleSlug : undefined,
          }),
          credentials: "same-origin",
        });
        const result = await response.json() as { draftId?: number; error?: string };
        if (response.status === 401) {
          router.replace(`/login?returnTo=${encodeURIComponent(location.pathname)}`);
          return;
        }
        if (!response.ok || !result.draftId) throw new Error(result.error || "无法创建草稿");
        router.replace(`/original/write/${result.draftId}`);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法打开编辑器");
      }
    })();
  }, [articleSlug, mode, router]);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div role="status" style={{ display: "grid", justifyItems: "center", gap: 12 }}>
        {error ? (
          <>
            <strong>{error}</strong>
            <button type="button" onClick={() => location.reload()}>重试</button>
          </>
        ) : (
          <>
            <LoaderCircle size={24} aria-hidden="true" style={{ animation: "spin 1s linear infinite" }} />
            <span>{mode === "edit" ? "正在载入文章草稿…" : "正在准备写作空间…"}</span>
          </>
        )}
      </div>
    </main>
  );
}
