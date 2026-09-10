import type { Metadata } from "next";
import { Bell, BookOpen, Clapperboard, File, FilePenLine, Headphones, Tags, type LucideIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { AppLink as Link } from "@/components/AppLink";
import { SiteHeader } from "@/components/SiteHeader";
import { readPostgresSiteSettings } from "@/core/config/site-settings";
import { database } from "@/core/db/postgres";
import {
  formatPostgresHomeUpdateTime,
  getPostgresHomeOverview,
} from "@/domains/navigation/postgres-home-overview";
import { getPostgresHomeAnnouncement } from "@/domains/station/postgres-station";
import {
  canBrowseHomePortal,
  isHomePortalEntryVisible,
  type HomePortalAccessMode,
  type HomePortalCardKey,
} from "@/lib/home-portal";
import type { MediaKind } from "@/domains/media/media-model";
import { languageAlternates, uiText, withLocalePath } from "@/lib/locale";
import { getRequestLocale, localizeText } from "@/lib/locale-server";
import { getCurrentUser } from "@/lib/user-auth";
import "./styles/common.css";
import "./styles/routes/home.css";

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
  kind: HomePortalCardKey;
  icon: LucideIcon;
  accessMode: HomePortalAccessMode;
};

const MEDIA_CARDS: Record<MediaKind, Omit<PortalCard, "kind" | "accessMode">> = {
  video: { href: "/media?kind=video", label: "视频", icon: Clapperboard },
  audio: { href: "/media?kind=audio", label: "音频", icon: Headphones },
  file: { href: "/media?kind=file", label: "文件", icon: File },
};

export async function generateMetadata(): Promise<Metadata> {
  const [locale, settings] = await Promise.all([getRequestLocale(), readPostgresSiteSettings()]);
  const title = await localizeText(settings.siteTitle || settings.siteName, locale);
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
  const [params, locale, user, settings] = await Promise.all([
    searchParams,
    getRequestLocale(),
    getCurrentUser(),
    readPostgresSiteSettings(),
  ]);
  const legacyParams = new URLSearchParams();
  if (params.page) legacyParams.set("page", params.page);
  if (params.q) legacyParams.set("q", params.q);
  if (params.random) legacyParams.set("random", params.random);
  if (legacyParams.size > 0) {
    redirect(withLocalePath(`/novels?${legacyParams.toString()}`, locale));
  }

  const authenticated = Boolean(user);
  const accessModes = settings.homePortalAccessModes;
  const announcementMode = accessModes.announcement;
  const showAnnouncement = isHomePortalEntryVisible(announcementMode, authenticated);
  const canReadAnnouncement = canBrowseHomePortal(announcementMode, authenticated);
  const announcement = showAnnouncement && canReadAnnouncement
    ? await getPostgresHomeAnnouncement(database("web"), authenticated)
    : null;
  const showNovels = isHomePortalEntryVisible(accessModes.novels, authenticated);
  const cards = new Map<HomePortalCardKey, PortalCard>();

  if (showAnnouncement) {
    cards.set("announcement", {
      href: announcement && settings.announcementCardTarget === "latest" ? `/announcements/${announcement.id}` : "/announcements",
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
      icon: BookOpen,
      accessMode: accessModes.novels,
    });
  }
  if (isHomePortalEntryVisible(accessModes.tags, authenticated)) {
    cards.set("tags", {
      href: "/tags",
      label: "标签",
      kind: "tags",
      icon: Tags,
      accessMode: accessModes.tags,
    });
  }
  if (settings.originalChannelEnabled && isHomePortalEntryVisible(accessModes.original, authenticated)) {
    cards.set("original", {
      href: "/original",
      label: "原创",
      kind: "original",
      icon: FilePenLine,
      accessMode: accessModes.original,
    });
  }
  for (const kind of Object.keys(MEDIA_CARDS) as MediaKind[]) {
    if (isHomePortalEntryVisible(accessModes[kind], authenticated)) {
      cards.set(kind, { ...MEDIA_CARDS[kind], kind, accessMode: accessModes[kind] });
    }
  }
  const homePortalOrder = settings.homePortalOrder;
  const overview = await getPostgresHomeOverview(database("web"), authenticated);

  return (
    <main className="appShell homePortalShell">
      <SiteHeader isHomePage showPrimaryNavigation={false} showSearch={false} currentUser={user} />
      <section className="homePortalGrid" aria-label="内容导航">
        {homePortalOrder.map((key) => {
          const card = cards.get(key);
          if (!card) return null;
          const Icon = card.icon;
          const label = uiText(locale, card.label);
          return (
            <Link
              className={`homePortalCard is-${card.kind} hasNoTrailingIcon`}
              href={card.href}
              prefetch
              key={card.kind}
            >
              <span className="homePortalCardIcon" aria-hidden="true">
                <Icon size={26} strokeWidth={1.7} />
              </span>
              <span className="homePortalCardCopy"><strong>{label}</strong><small>{overview[card.kind]?.count || 0} {card.kind === "announcement" ? "条" : card.kind === "novels" ? "本" : card.kind === "original" ? "篇" : "个"}{label}　最近更新：{formatPostgresHomeUpdateTime(overview[card.kind]?.updatedAt || null)}</small></span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
