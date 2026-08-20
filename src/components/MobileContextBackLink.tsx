"use client";

import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";
import Link from "@/components/LocalizedLink";
import { shouldUseContextHistoryBack } from "@/lib/context-navigation";
import { requestRouteScrollRestore } from "./RouteScrollState";

export function MobileContextBackLink({ href, label }: { href: string; label: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const plainPrimaryClick = !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey;
    if (!plainPrimaryClick) return;
    if (shouldUseContextHistoryBack(event.currentTarget.href)) {
      event.preventDefault();
      window.history.back();
      return;
    }
    requestRouteScrollRestore(href);
  }

  return (
    <Link
      className="mobileContextBackLink"
      href={href}
      prefetch={false}
      scroll={false}
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <ChevronLeft size={25} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}
