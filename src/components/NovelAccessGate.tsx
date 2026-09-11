"use client";

import { CupSoda, LoaderCircle, LogIn } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { jsonMutationRequest } from "@/core/security/browser-mutation";

export function NovelAccessGate({
  novelId,
  price,
  loginRequired,
  notice,
}: {
  novelId: number;
  price: number;
  loginRequired: boolean;
  /** Why the reader landed on the gate, e.g. a search hit inside a locked chapter. */
  notice?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function unlock() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/novels/${novelId}/unlock`,
        jsonMutationRequest({ method: "POST" }),
      );
      const body = await response.json() as { ok?: boolean; message?: string };
      if (!response.ok || !body.ok) throw new Error(body.message || "暂时无法解锁");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "暂时无法解锁");
    } finally {
      setLoading(false);
    }
  }

  const returnTo = `${pathname}${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  return (
    <section className="novelAccessGate" aria-live="polite">
      <div className="novelAccessGateAction">
        <strong>{loginRequired ? "登录后继续阅读" : "解锁完整内容"}</strong>
        {loginRequired ? (
          <button
            type="button"
            className="novelAccessGateButton"
            onClick={() => router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`)}
          >
            <LogIn size={17} aria-hidden="true" />登录
          </button>
        ) : (
          <button
            type="button"
            className="novelAccessGateButton"
            onClick={() => void unlock()}
            disabled={loading}
          >
            {loading ? <LoaderCircle className="isSpinning" size={17} aria-hidden="true" /> : <CupSoda size={17} aria-hidden="true" />}
            {price} 苏打
          </button>
        )}
      </div>
      {notice ? <small className="novelAccessGateNotice">{notice}</small> : null}
      {message ? <small className="novelAccessGateError" role="alert">{message}</small> : null}
    </section>
  );
}
