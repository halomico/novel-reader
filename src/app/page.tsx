import type { Metadata } from "next";
import { Bell, BookOpenText, ChevronRight, Clapperboard, File, Headphones, LockKeyhole, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatalogRandomCard } from "@/components/CatalogRandomButton";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getAnnouncementCardTarget,
  getHomePortalOrder,
  getSiteTitle,
  isRandomCatalogEnabled,
} from "@/lib/config";
import {
  isHomePortalCardVisible,
  resolveHomePortalAccessMode,
  type HomePortalAccessMode,
  type HomePortalCardKey,
  type HomePortalContentCardKey,
} from "@/lib/home-portal";
import type { MediaKind } from "@/lib/media";
import { readSiteSettings } from "@/lib/site-settings";
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
  accessMode: HomePortalAccessMode;
};

const MEDIA_CARDS: Record<MediaKind, Omit<PortalCard, "kind" | "accessMode">> = {
  video: { href: "/media?kind=video", label: "视频", icon: Clapperboard },
  audio: { href: "/media?kind=audio", label: "音频", icon: Headphones },
  file: { href: "/media?kind=file", label: "文件", icon: File },
};

function gatedCardHref(href: string, mode: HomePortalAccessMode, authenticated: boolean): string {
  if (authenticated || mode !== "preview") return href;
  return `/login?${new URLSearchParams({ returnTo: href }).toString()}`;
}

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
  const settings = readSiteSettings();
  const publicDisplayCards = new Set<HomePortalContentCardKey>(settings.publicDisplayHomeCards);
  const accessModes: Record<HomePortalContentCardKey, HomePortalAccessMode> = {
    announcement: resolveHomePortalAccessMode(
      settings.announcementCardEnabled,
      settings.guestAnnouncementCardEnabled,
      publicDisplayCards.has("announcement"),
    ),
    novels: resolveHomePortalAccessMode(
      settings.novelLibraryEnabled,
      settings.guestLibraryNavEnabled,
      publicDisplayCards.has("novels"),
    ),
    tags: resolveHomePortalAccessMode(
      settings.tagLibraryEnabled,
      settings.guestTagLibraryNavEnabled,
      publicDisplayCards.has("tags"),
    ),
    video: resolveHomePortalAccessMode(
      settings.videoLibraryEnabled,
      settings.guestVideoNavEnabled,
      publicDisplayCards.has("video"),
    ),
    audio: resolveHomePortalAccessMode(
      settings.audioLibraryEnabled,
      settings.guestAudioNavEnabled,
      publicDisplayCards.has("audio"),
    ),
    file: resolveHomePortalAccessMode(
      settings.fileLibraryEnabled,
      settings.guestFileNavEnabled,
      publicDisplayCards.has("file"),
    ),
  };
  const announcementMode = accessModes.announcement;
  const announcement = isHomePortalCardVisible(announcementMode, authenticated)
    ? getHomeAnnouncement(authenticated || announcementMode === "preview")
    : null;
  const showNovels = isHomePortalCardVisible(accessModes.novels, authenticated);
  const cards = new Map<Exclude<HomePortalCardKey, "random">, PortalCard>();

  if (announcement) {
    cards.set("announcement", {
      href: getAnnouncementCardTarget() === "latest" ? `/announcements/${announcement.id}` : "/announcements",
      label: "公告",
      kind: "announcement",
      icon: Bell,
      accessMode: announcementMode,
    });
  }
  if (showNovels) {
    cards.set("novels", {
      href: "/novels",
      label: "小说",
      kind: "novels",
      icon: BookOpenText,
      accessMode: accessModes.novels,
    });
  }
  if (isHomePortalCardVisible(accessModes.tags, authenticated)) {
    cards.set("tags", {
      href: "/tags",
      label: "标签",
      kind: "tags",
      icon: Tags,
      accessMode: accessModes.tags,
    });
  }
  for (const kind of Object.keys(MEDIA_CARDS) as MediaKind[]) {
    if (isHomePortalCardVisible(accessModes[kind], authenticated)) {
      cards.set(kind, { ...MEDIA_CARDS[kind], kind, accessMode: accessModes[kind] });
    }
  }
  const homePortalOrder = getHomePortalOrder();

  return (
    <main className="appShell homePortalShell">
      <SiteHeader showPrimaryNavigation={false} showTools={false} isHomePage currentUser={user} />
      <section className="homePortalGrid" aria-label="内容导航">
        {homePortalOrder.map((key) => {
          if (key === "random") {
            return showNovels && isRandomCatalogEnabled()
              ? <CatalogRandomCard loginRequired={!authenticated && accessModes.novels === "preview"} key={key} />
              : null;
          }
          const card = cards.get(key);
          if (!card) return null;
          const Icon = card.icon;
          return (
            <Link
              className={`homePortalCard is-${card.kind}`}
              href={gatedCardHref(card.href, card.accessMode, authenticated)}
              title={!authenticated && card.accessMode === "preview" ? "登录后可用" : undefined}
              aria-label={!authenticated && card.accessMode === "preview" ? `${card.label}，登录后可用` : undefined}
              key={card.kind}
            >
              <span className="homePortalCardIcon" aria-hidden="true">
                <Icon size={30} />
              </span>
              <strong>{card.label}</strong>
              {!authenticated && card.accessMode === "preview"
                ? <LockKeyhole className="homePortalCardArrow" size={17} aria-hidden="true" />
                : <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />}
            </Link>
          );
        })}
      </section>
    </main>
  );
}
