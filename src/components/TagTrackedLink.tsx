"use client";

import Link from "next/link";
import type { ReactNode } from "react";

function recordTagClick(slug: string) {
  const body = JSON.stringify({ slug });
  if (typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon("/api/analytics/tag-click", new Blob([body], { type: "application/json" }));
    if (sent) return;
  }
  void fetch("/api/analytics/tag-click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function TagTrackedLink({
  slug,
  className,
  title,
  children,
}: {
  slug: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Link className={className} href={`/tags/${slug}`} title={title} onClick={() => recordTagClick(slug)}>
      {children}
    </Link>
  );
}
