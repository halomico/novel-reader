"use client";

import type { ComponentProps, MouseEvent } from "react";
import { IntentPrefetchLink as Link } from "@/components/IntentPrefetchLink";
import { rememberContextNavigation } from "@/lib/context-navigation";

type ContextNavigationLinkProps = ComponentProps<typeof Link> & {
  contextReturnHref?: string;
  documentNavigation?: boolean;
};

function isPlainPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    (!event.currentTarget.target || event.currentTarget.target === "_self") &&
    !event.currentTarget.hasAttribute("download");
}

export function ContextNavigationLink({
  contextReturnHref,
  documentNavigation = false,
  onClick,
  prefetch,
  ...props
}: ContextNavigationLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (!isPlainPrimaryClick(event)) return;
    rememberContextNavigation(event.currentTarget.href, contextReturnHref);
    if (documentNavigation) {
      event.preventDefault();
      window.location.assign(event.currentTarget.href);
    }
  }

  return (
    <Link
      {...props}
      intentPrefetch={!documentNavigation && prefetch !== false}
      onClick={handleClick}
      prefetch={documentNavigation ? false : prefetch}
    />
  );
}
