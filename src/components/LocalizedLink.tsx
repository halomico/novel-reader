"use client";

import Link, { type LinkProps } from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { localeFromPathname, withLocalePath } from "@/lib/locale";

type LocalizedLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: LinkProps["href"];
};

export default function LocalizedLink({ href, ...props }: LocalizedLinkProps) {
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

  return <Link href={localizedHref} {...props} />;
}
