import type { Metadata } from "next";
import { Bell, BookOpenText, ChevronRight, Clapperboard, File, Headphones, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatalogRandomCard } from "@/components/CatalogRandomButton";
import { SiteHeader } from "@/components/SiteHeader";
import {
  canAccessHomeAnnouncementCard,
  getHomePortalOrder,
  getSiteTitle,
  isGuestLibraryNavEnabled,
  isGuestTagLibraryNavEnabled,
  isRandomCatalogEnabled,
  isNovelLibraryEnabled,
  isTagLibraryEnabled,
} from "@/lib/config";
import type { HomePortalCardKey } from "@/lib/home-portal";
import { getAccessibleMediaKinds, type MediaKind } from "@/lib/media";
import { getCurrentUser } from "@/lib/user-auth";
import { getHomeAnnouncement } from "@/lib/station";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{
    page?: string;
    q?: string;
    random?: string;
  }>;
};

type PortalCard = {
  href: string;
  label: string;
  kind: Exclude<HomePortalCardKey, "random">;
  icon: LucideIcon;
};

const MEDIA_CARDS: Record<MediaKind, Omit<PortalCard, "kind">> = {
  video: { href: "/media?kind=video", label: "视频", icon: Clapperboard },
  audio: { href: "/media?kind=audio", label: "音频", icon: Headphones },
  file: { href: "/media?kind=file", label: "文件", icon: File },
};

export function generateMetadata(): Metadata {
  const title = getSiteTitle();
  return {
    title: { absolute: title },
    description: "浏览站内小说、标签与已开放的资源。",
    alternates: { canonical: "/" },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description: "浏览站内小说、标签与已开放的资源。",
      url: "/",
    },
  };
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const legacyParams = new URLSearchParams();
  if (params.page) legacyParams.set("page", params.page);
  if (params.q) legacyParams.set("q", params.q);
  if (params.random) legacyParams.set("random", params.random);
  if (legacyParams.size > 0) {
    redirect(`/novels?${legacyParams.toString()}`);
  }

  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  const announcement = canAccessHomeAnnouncementCard(authenticated)
    ? getHomeAnnouncement(authenticated)
    : null;
  const showNovels = isNovelLibraryEnabled() && (authenticated || isGuestLibraryNavEnabled());
  const cards = new Map<Exclude<HomePortalCardKey, "random">, PortalCard>();

  if (announcement) {
    cards.set("announcement", {
      href: "/announcements",
      label: "公告",
      kind: "announcement",
      icon: Bell,
    });
  }
  if (showNovels) {
    cards.set("novels", { href: "/novels", label: "小说", kind: "novels", icon: BookOpenText });
  }
  if (isTagLibraryEnabled() && (authenticated || isGuestTagLibraryNavEnabled())) {
    cards.set("tags", { href: "/tags", label: "标签", kind: "tags", icon: Tags });
  }
  for (const kind of getAccessibleMediaKinds(authenticated)) {
    cards.set(kind, { ...MEDIA_CARDS[kind], kind });
  }
  const homePortalOrder = getHomePortalOrder();

  return (
    <main className="appShell homePortalShell">
      <SiteHeader showPrimaryNavigation={false} showTools={false} isHomePage currentUser={user} />
      <section className="homePortalGrid" aria-label="内容导航">
        {homePortalOrder.map((key) => {
          if (key === "random") {
            return showNovels && isRandomCatalogEnabled() ? <CatalogRandomCard key={key} /> : null;
          }
          const card = cards.get(key);
          if (!card) return null;
          const Icon = card.icon;
          return (
            <Link className={`homePortalCard is-${card.kind}`} href={card.href} key={card.kind}>
              <span className="homePortalCardIcon" aria-hidden="true">
                <Icon size={30} />
              </span>
              <strong>{card.label}</strong>
              <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />
            </Link>
          );
        })}
      </section>
    </main>
  );
}
