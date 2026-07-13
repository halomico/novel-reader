"use client";

import { BookOpen, Clapperboard, File, Headphones } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { MediaKind } from "@/lib/media";

const MEDIA_LINKS: Record<MediaKind, { label: string; icon: typeof Clapperboard }> = {
  video: { label: "视频", icon: Clapperboard },
  audio: { label: "音频", icon: Headphones },
  file: { label: "文件", icon: File },
};

export function HeaderPrimaryNav({ mediaKinds }: { mediaKinds: MediaKind[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedKind = searchParams.get("kind");
  const activeKind = mediaKinds.includes(requestedKind as MediaKind) ? requestedKind : mediaKinds[0];

  return (
    <nav className="headerPrimaryNav" aria-label="前台主导航">
      <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>
        <BookOpen size={15} aria-hidden="true" />
        书库
      </Link>
      {mediaKinds.map((kind) => {
        const item = MEDIA_LINKS[kind];
        const Icon = item.icon;
        const active = pathname === "/media" && activeKind === kind;
        return (
          <Link href={`/media?kind=${kind}`} aria-current={active ? "page" : undefined} key={kind}>
            <Icon size={15} aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
