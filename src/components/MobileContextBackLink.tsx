"use client";

import { ChevronLeft } from "lucide-react";
import Link from "@/components/LocalizedLink";
import { requestRouteScrollRestore } from "./RouteScrollState";

export function MobileContextBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="mobileContextBackLink"
      href={href}
      scroll={false}
      aria-label={label}
      title={label}
      onClick={() => requestRouteScrollRestore(href)}
    >
      <ChevronLeft size={25} strokeWidth={1.8} aria-hidden="true" />
    </Link>
  );
}
