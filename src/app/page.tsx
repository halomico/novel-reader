import type { Metadata } from "next";
import { Bell, BookOpenText, ChevronRight, Clapperboard, Clock3, File, Headphones, Tags, type LucideIcon } from "lucide-react";
import { redirect } from "next/navigation";
import Link from "@/components/LocalizedLink";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getAnnouncementCardTarget,
  getHomePortalOrder,
  getSiteTitle,
  canAccessHomeAnnouncementCard,
} from "@/lib/config";
import {
  isHomePortalCardVisible,
  type HomePortalAccessMode,
  type HomePortalCardKey,
} from "@/lib/home-portal";
import { formatHomeUpdateTime, getHomeOverview } from "@/lib/home-overview";
import type { MediaKind } from "@/lib/media";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
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
  kind: Exclude<HomePortalCardKey, "recent">;
  icon: LucideIcon;
  accessMode: HomePortalAccessMode;
};

const MEDIA_CARDS: Record<MediaKind, Omit<PortalCard, "kind" | "accessMode">> = {
  video: { href: "/media?kind=video", label: "视频", icon: Clapperboard },
  audio: { href: "/media?kind=audio", label: "音频", icon: Headphones },
  file: { href: "/media?kind=file", label: "文件", icon: File },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const title = await localizeText(getSiteTitle(), locale);
  const description = await localizeText("浏览站内小说、标签与已开放的资源。", locale);
  const canonical = withLocalePath("/", locale);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical, languages: languageAlternates("/") },
    robots: { index: true, follow: true },
    openGraph: {
      title,
      description,
      url: canonical,
    },
  };
}

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const locale = await getRequestLocale();
  const legacyParams = new URLSearchParams();
  if (params.page) legacyParams.set("page", params.page);
  if (params.q) legacyParams.set("q", params.q);
  if (params.random) legacyParams.set("random", params.random);
  if (legacyParams.size > 0) {
    redirect(withLocalePath(`/novels?${legacyParams.toString()}`, locale));
  }

  const user = await getCurrentUser();
  const authenticated = Boolean(user);
  const settings = readSiteSettings();
  const accessModes = settings.homePortalAccessModes;
  const announcementMode = accessModes.announcement;
  const showAnnouncement = isHomePortalCardVisible(announcementMode, authenticated);
  const canReadAnnouncement = canAccessHomeAnnouncementCard(authenticated);
  const announcement = showAnnouncement && canReadAnnouncement
    ? getHomeAnnouncement(authenticated)
    : null;
  const showNovels = isHomePortalCardVisible(accessModes.novels, authenticated);
  const cards = new Map<Exclude<HomePortalCardKey, "recent">, PortalCard>();

  if (showAnnouncement) {
    cards.set("announcement", {
      href: announcement && getAnnouncementCardTarget() === "latest" ? `/announcements/${announcement.id}` : "/announcements",
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
  const overview = getHomeOverview(authenticated);

  return (
    <main className="appShell homePortalShell">
      <SiteHeader isHomePage showPrimaryNavigation={false} showSearch={false} currentUser={user} />
      <section className="homePortalGrid" aria-label="内容导航">
        {homePortalOrder.map((key) => {
          if (key === "recent") {
            if (!showNovels) return null;
            const recentOverview = overview.recent;
            return (
              <Link className="homePortalCard is-recent" href="/novels/recent" key={key}>
                <span className="homePortalCardIcon" aria-hidden="true"><Clock3 size={30} /></span>
                <span className="homePortalCardCopy"><strong>{uiText(locale, "最近更新")}</strong><small>最近更新：{formatHomeUpdateTime(recentOverview?.updatedAt || null)}</small></span>
                <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />
              </Link>
            );
          }
          const card = cards.get(key);
          if (!card) return null;
          const Icon = card.icon;
          const label = uiText(locale, card.label);
          return (
            <Link
              className={`homePortalCard is-${card.kind}`}
              href={card.href}
              key={card.kind}
            >
              <span className="homePortalCardIcon" aria-hidden="true">
                <Icon size={30} />
              </span>
              <span className="homePortalCardCopy"><strong>{label}</strong><small>{overview[card.kind]?.count || 0} {card.kind === "announcement" ? "条" : card.kind === "novels" ? "本" : "个"}{label}　最近更新：{formatHomeUpdateTime(overview[card.kind]?.updatedAt || null)}</small></span>
              <ChevronRight className="homePortalCardArrow" size={19} aria-hidden="true" />
            </Link>
          );
        })}
      </section>
    </main>
  );
}
