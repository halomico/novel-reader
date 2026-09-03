"use client";

import { AppLink as Link } from "@/components/AppLink";
import { usePathname, useSearchParams } from "next/navigation";
import type { MediaKind } from "@/lib/media";
import { localeFromPathname, stripLocalePath, uiText } from "@/lib/locale";

const MEDIA_LINKS: Record<MediaKind, string> = {
  video: "视频",
  audio: "音频",
  file: "文件",
};

export function HeaderPrimaryNav({
  mediaKinds,
  showLibrary = true,
  showTags = false,
  showOriginal = false,
  className = "headerPrimaryNav",
  ariaLabel = "前台主导航",
  onNavigate,
}: {
  mediaKinds: MediaKind[];
  showLibrary?: boolean;
  showTags?: boolean;
  showOriginal?: boolean;
  className?: string;
  ariaLabel?: string;
  onNavigate?: () => void;
}) {
  const rawPathname = usePathname();
  const locale = localeFromPathname(rawPathname);
  const pathname = stripLocalePath(rawPathname);
  const searchParams = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const activeKind = mediaKinds.includes(requestedKind as MediaKind) ? requestedKind : mediaKinds[0];

  return (
    <nav className={className} aria-label={ariaLabel}>
      {showLibrary ? (
        <Link href="/novels" aria-current={pathname === "/novels" ? "page" : undefined} onClick={onNavigate}>
          {uiText(locale, "小说")}
        </Link>
      ) : null}
      {showTags ? (
        <Link href="/tags" aria-current={pathname.startsWith("/tags") ? "page" : undefined} onClick={onNavigate}>
          {uiText(locale, "标签")}
        </Link>
      ) : null}
      {showOriginal ? (
        <Link href="/original" aria-current={pathname.startsWith("/original") ? "page" : undefined} onClick={onNavigate}>
          {uiText(locale, "原创")}
        </Link>
      ) : null}
      {mediaKinds.map((kind) => {
        const active = (pathname === "/media" && activeKind === kind) || (kind === "video" && pathname.startsWith("/media/tags"));
        return (
          <Link href={`/media?kind=${kind}`} aria-current={active ? "page" : undefined} key={kind} onClick={onNavigate}>
            {uiText(locale, MEDIA_LINKS[kind])}
          </Link>
        );
      })}
    </nav>
  );
}
