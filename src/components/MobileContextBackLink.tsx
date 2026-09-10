"use client";

import { ChevronLeft } from "lucide-react";
import { useEffect, useRef, type MouseEvent } from "react";
import { usePathname } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { shouldUseContextHistoryBack } from "@/lib/context-navigation";

export function MobileContextBackLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const navigatingRef = useRef(false);

  useEffect(() => {
    navigatingRef.current = false;
  }, [href, pathname]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    const plainPrimaryClick = !event.defaultPrevented &&
      event.button === 0 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey;
    if (!plainPrimaryClick) return;
    if (navigatingRef.current) {
      event.preventDefault();
      return;
    }
    navigatingRef.current = true;
    if (shouldUseContextHistoryBack(event.currentTarget.href)) {
      event.preventDefault();
      window.history.back();
    }
  }

  return (
    <Link
      className="mobileContextBackLink"
      href={href}
      prefetch={false}
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <ChevronLeft size={25} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}
