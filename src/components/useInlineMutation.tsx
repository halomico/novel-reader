"use client";

import { useEffect, useState, useTransition } from "react";
import type { MutationResult, MutationTone } from "@/lib/mutation-result";

type MutationNotice = {
  id: number;
  message: string;
  tone: MutationTone;
};

export function useInlineMutation() {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<MutationNotice | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2_800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  function run<T>(
    task: () => Promise<MutationResult<T>>,
    onComplete?: (result: MutationResult<T>) => void,
  ) {
    if (pending) return;
    startTransition(async () => {
      try {
        const result = await task();
        setNotice({ id: Date.now(), message: result.message, tone: result.tone });
        onComplete?.(result);
      } catch {
        setNotice({ id: Date.now(), message: "操作失败，请稍后重试", tone: "error" });
      }
    });
  }

  return { pending, notice, run };
}

export function InlineMutationNotice({ notice }: { notice: MutationNotice | null }) {
  if (!notice) return null;
  return (
    <p className={`inlineMutationNotice is-${notice.tone}`} role="status" key={notice.id}>
      {notice.message}
    </p>
  );
}

export function mutationNoticePath(
  pathname: string,
  result: Pick<MutationResult, "message" | "tone">,
): string {
  const params = new URLSearchParams({
    notice: result.message,
    tone: result.tone,
  });
  return `${pathname}${pathname.includes("?") ? "&" : "?"}${params.toString()}`;
}
