import type { Metadata } from "next";
import { BookOpenText, ChevronRight, Clapperboard, File, Headphones, Tags, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CatalogRandomCard } from "@/components/CatalogRandomButton";
import { SiteHeader } from "@/components/SiteHeader";
import {
  getSiteTitle,
  isGuestLibraryNavEnabled,
  isGuestTagLibraryNavEnabled,
  isRandomCatalogEnabled,
  isNovelLibraryEnabled,
  isTagLibraryEnabled,
} from "@/lib/config";
import { getAccessibleMediaKinds, type MediaKind } from "@/lib/media";
import { getCurrentUser } from "@/lib/user-auth";

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
  kind: "novels" | "tags" | MediaKind;
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
  const showNovels = isNovelLibraryEnabled() && (authenticated || isGuestLibraryNavEnabled());
  const cards: PortalCard[] = [];

  if (showNovels) {
    cards.push({ href: "/novels", label: "小说", kind: "novels", icon: BookOpenText });
  }
  if (isTagLibraryEnabled() && (authenticated || isGuestTagLibraryNavEnabled())) {
    cards.push({ href: "/tags", label: "标签", kind: "tags", icon: Tags });
  }
  for (const kind of getAccessibleMediaKinds(authenticated)) {
    cards.push({ ...MEDIA_CARDS[kind], kind });
  }

  return (
    <main className="appShell homePortalShell">
      <SiteHeader showPrimaryNavigation={false} showTools={false} isHomePage currentUser={user} />
      <section className="homePortalGrid" aria-label="内容导航">
        {cards.map((card) => {
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
        {showNovels && isRandomCatalogEnabled() ? <CatalogRandomCard /> : null}
      </section>
    </main>
  );
}
