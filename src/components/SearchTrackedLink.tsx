"use client";

import { ContextNavigationLink } from "@/components/ContextNavigationLink";

export function SearchTrackedLink({
  className,
  eventKey,
  href,
  novelId,
  returnHref,
  segmentIndex,
  onClick,
  children,
}: {
  className: string;
  eventKey?: string | null;
  href: string;
  novelId: number;
  returnHref?: string;
  segmentIndex?: number;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  function trackClick() {
    onClick?.();
    if (eventKey) {
      void fetch("/api/search/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "click", eventKey, novelId, segmentIndex }),
        keepalive: true,
      }).catch(() => undefined);
    }
  }

  return (
    <ContextNavigationLink
      className={className}
      contextReturnHref={returnHref}
      href={href}
      onClick={trackClick}
      // Dense result grids must not prefetch every visible card. The wrapped
      // IntentPrefetchLink still prefetches after real hover/focus/touch intent.
      prefetch={false}
    >
      {children}
    </ContextNavigationLink>
  );
}
