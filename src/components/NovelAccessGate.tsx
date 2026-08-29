"use client";

import { CupSoda, LoaderCircle, LogIn } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function NovelAccessGate({
  novelId,
  price,
  loginRequired,
}: {
  novelId: number;
  price: number;
  loginRequired: boolean;
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
      const response = await fetch(`/api/novels/${novelId}/unlock`, { method: "POST" });
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
      <div>
        <strong>{loginRequired ? "登录后继续阅读" : "解锁完整内容"}</strong>
      </div>
      {loginRequired ? (
        <button type="button" onClick={() => router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`)}>
          <LogIn size={17} aria-hidden="true" />登录
        </button>
      ) : (
        <button type="button" onClick={() => void unlock()} disabled={loading}>
          {loading ? <LoaderCircle className="isSpinning" size={17} aria-hidden="true" /> : <CupSoda size={17} aria-hidden="true" />}
          {price} 苏打
        </button>
      )}
      {message ? <small role="alert">{message}</small> : null}
    </section>
  );
}
