"use client";

import { AppLink as Link } from "@/components/AppLink";
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

function TagLinkPendingState() {
  const { pending } = useLinkStatus();
  return <span className="tagLinkPendingState" data-pending={pending ? "true" : "false"} aria-hidden="true" />;
}

function recordTagClick(slug: string) {
  const body = JSON.stringify({ slug });
  if (typeof navigator.sendBeacon === "function") {
    const sent = navigator.sendBeacon("/api/analytics/tag-click", new Blob([body], { type: "application/json" }));
    if (sent) return;
  }
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
      prefetch={false}
      onClick={() => recordTagClick(slug)}
      data-tag-search={tagSearchText}
    >
      {children}
      <TagLinkPendingState />
    </Link>
  );
}
