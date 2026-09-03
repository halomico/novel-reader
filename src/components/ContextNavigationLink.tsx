"use client";

import type { ComponentProps, MouseEvent } from "react";
import { AppLink as Link } from "@/components/AppLink";
import { rememberContextNavigation } from "@/lib/context-navigation";

type ContextNavigationLinkProps = ComponentProps<typeof Link> & {
  contextReturnHref?: string;
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
  onClick,
  ...props
}: ContextNavigationLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (!isPlainPrimaryClick(event)) return;
    rememberContextNavigation(event.currentTarget.href, contextReturnHref);
  }

  return (
    <Link
      {...props}
      onClick={handleClick}
    />
  );
}
