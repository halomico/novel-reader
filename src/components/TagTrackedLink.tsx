"use client";

import { AppLink as Link } from "@/components/AppLink";
import type { ReactNode } from "react";

function recordTagClick(slug: string) {
  const body = JSON.stringify({ slug });
  void fetch("/api/analytics/tag-click", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Novel-Mutation": "1" },
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
      className={["tagTrackedLink", className].filter(Boolean).join(" ")}
      href={`/tags/${slug}${library && library !== "default" ? `?library=${encodeURIComponent(library)}` : ""}`}
      title={title}
      onClick={() => recordTagClick(slug)}
      data-tag-search={tagSearchText}
    >
      {children}
    </Link>
  );
}
