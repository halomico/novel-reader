"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { useLinkNavigationProgress } from "@/components/NavigationProgress";
import { localeFromPathname, withLocalePath } from "@/lib/locale";

type LocalizedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: LinkProps["href"];
};

export default function LocalizedLink({ href, onClick, onNavigate, ...props }: LocalizedLinkProps) {
  const progress = useLinkNavigationProgress(onClick, onNavigate);
  const pathname = usePathname();
  const locale = localeFromPathname(pathname);
  const localizedHref = typeof href === "string"
    ? withLocalePath(href, locale)
    : {
        ...href,
        pathname: typeof href.pathname === "string"
          ? withLocalePath(href.pathname, locale)
          : href.pathname,
      };

  return <Link href={localizedHref} {...props} onClick={progress.onClick} onNavigate={progress.onNavigate} />;
}
