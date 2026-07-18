"use client";

import { BookOpen, Clapperboard, File, Headphones, Tags } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { MediaKind } from "@/lib/media";

const MEDIA_LINKS: Record<MediaKind, { label: string; icon: typeof Clapperboard }> = {
  video: { label: "视频", icon: Clapperboard },
  audio: { label: "音频", icon: Headphones },
  file: { label: "文件", icon: File },
};

export function HeaderPrimaryNav({
  mediaKinds,
  showLibrary = true,
  showTags = false,
  className = "headerPrimaryNav",
  ariaLabel = "前台主导航",
  onNavigate,
}: {
  mediaKinds: MediaKind[];
  showLibrary?: boolean;
  showTags?: boolean;
  className?: string;
  ariaLabel?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const activeKind = mediaKinds.includes(requestedKind as MediaKind) ? requestedKind : mediaKinds[0];

  return (
    <nav className={className} aria-label={ariaLabel}>
      {showLibrary ? (
        <Link href="/novels" aria-current={pathname === "/novels" ? "page" : undefined} onClick={onNavigate}>
          <BookOpen size={15} aria-hidden="true" />
          小说
        </Link>
      ) : null}
      {showTags ? (
        <Link href="/tags" aria-current={pathname.startsWith("/tags") ? "page" : undefined} onClick={onNavigate}>
          <Tags size={15} aria-hidden="true" />
          标签
        </Link>
      ) : null}
      {mediaKinds.map((kind) => {
        const item = MEDIA_LINKS[kind];
        const Icon = item.icon;
        const active = pathname === "/media" && activeKind === kind;
        return (
          <Link href={`/media?kind=${kind}`} aria-current={active ? "page" : undefined} key={kind} onClick={onNavigate}>
            <Icon size={15} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
