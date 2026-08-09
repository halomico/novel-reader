"use client";

import Link from "@/components/LocalizedLink";
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
  library,
  children,
  "data-tag-search": tagSearchText,
}: {
  slug: string;
  className?: string;
  title?: string;
  library?: string;
  "data-tag-search"?: string;
  children: ReactNode;
}) {
  return (
    <Link
      className={className}
      href={`/tags/${slug}${library && library !== "default" ? `?library=${encodeURIComponent(library)}` : ""}`}
      title={title}
      prefetch={false}
      onClick={() => recordTagClick(slug)}
      data-tag-search={tagSearchText}
    >
      {children}
    </Link>
  );
}
