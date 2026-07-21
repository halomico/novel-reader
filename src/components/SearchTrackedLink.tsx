"use client";

import Link from "next/link";

export function SearchTrackedLink({
  className,
  eventKey,
  href,
  novelId,
  segmentIndex,
  onClick,
  children,
}: {
  className: string;
  eventKey?: string | null;
  href: string;
  novelId: number;
  segmentIndex?: number;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  function trackClick() {
    onClick?.();
    if (!eventKey) return;
    void fetch("/api/search/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "click", eventKey, novelId, segmentIndex }),
      keepalive: true,
    }).catch(() => undefined);
  }

  return (
    <Link className={className} href={href} onClick={trackClick}>
      {children}
    </Link>
  );
}
